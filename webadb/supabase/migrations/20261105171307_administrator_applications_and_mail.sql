-- Additive rollout: legacy pending applications remain readable until the new UI is deployed.
begin;
alter table public.admin_applications
 add column if not exists applicant_name text not null default '',
 add column if not exists organization_type text not null default '',
 add column if not exists location text not null default '',
 add column if not exists experience text not null default '',
 add column if not exists intended_use text not null default '',
 add column if not exists expected_devices text not null default '',
 add column if not exists whatsapp text not null default '',
 add column if not exists whatsapp_consent boolean not null default false,
 add column if not exists privacy_acknowledged boolean not null default false,
 add column if not exists application_version integer not null default 0;

create table if not exists public.application_emails (
 id uuid primary key default gen_random_uuid(),
 application_id uuid not null references public.admin_applications(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 recipient text not null,
 event text not null check(event in ('pending','approved','rejected')),
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','skipped')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 lease_until timestamptz,
 sent_at timestamptz,
 last_error text,
 created_at timestamptz not null default now(),
 unique(application_id,event)
);
create index if not exists application_emails_ready on public.application_emails(next_attempt_at) where status in ('pending','failed','sending');
alter table public.application_emails enable row level security;
revoke all on public.application_emails from public,anon,authenticated;
grant select on public.application_emails to authenticated;
grant all on public.application_emails to service_role;
grant select on public.admin_applications,public.platform_admins to service_role;
drop policy if exists application_email_status on public.application_emails;
create policy application_email_status on public.application_emails for select to authenticated
 using(user_id=(select auth.uid()) or public.is_platform_owner());

-- An applicant cannot choose the recipient, pre-approve a request or forge review metadata.
create or replace function public.validate_application_submission() returns trigger
 language plpgsql security definer set search_path='' as $$
declare canonical_email text;
begin
 if new.status <> 'pending' then raise exception 'Une nouvelle candidature doit être en attente.'; end if;
 select email into canonical_email from auth.users where id=new.user_id and email_confirmed_at is not null;
 if canonical_email is null then raise exception 'Confirmez votre adresse e-mail avant de postuler.'; end if;
 new.email=canonical_email; new.reviewed_at=null; new.reviewed_by=null;
 if new.application_version=1 then
  if length(trim(new.applicant_name)) not between 2 and 100 or length(trim(new.store_name)) not between 2 and 120
   or length(trim(new.location)) not between 2 and 160 or length(trim(new.reason)) not between 30 and 2000
   or length(trim(new.experience)) not between 10 and 2000 or length(trim(new.intended_use)) not between 20 and 2000
   or new.organization_type not in ('shop','association','independent','other')
   or new.expected_devices not in ('1-10','11-50','51-200','200+') or not new.privacy_acknowledged
   or (new.whatsapp<>'' and new.whatsapp !~ '^\+[1-9][0-9]{7,14}$')
   or (new.whatsapp_consent and new.whatsapp='') then raise exception 'Complétez les réponses et vérifiez le numéro WhatsApp.'; end if;
 elsif new.application_version<>0 then raise exception 'Version de formulaire invalide.';
 end if;
 return new;
end; $$;
revoke all on function public.validate_application_submission() from public,anon,authenticated;
drop trigger if exists validate_application_submission on public.admin_applications;
create trigger validate_application_submission before insert on public.admin_applications
 for each row execute function public.validate_application_submission();

create or replace function public.submit_admin_application(details jsonb) returns public.admin_applications
 language plpgsql security definer set search_path='' as $$
declare account_id uuid=auth.uid(); application public.admin_applications;
begin
 if account_id is null then raise exception 'Connectez-vous avant de postuler.'; end if;
 if exists(select 1 from public.platform_admins where user_id=account_id) then raise exception 'Ce compte dispose déjà d’un rôle. Contactez le propriétaire pour modifier son accès.'; end if;
 -- Serialize per account, including rate limits and pending-request deduplication.
 perform 1 from auth.users where id=account_id for update;
 if (select count(*) from public.admin_applications where user_id=account_id and created_at>now()-interval '1 day')>=3 then raise exception 'Limite quotidienne atteinte. Réessayez demain.'; end if;
 insert into public.admin_applications(user_id,store_name,reason,applicant_name,organization_type,location,experience,intended_use,expected_devices,whatsapp,whatsapp_consent,privacy_acknowledged,application_version)
 values(account_id,trim(coalesce(details->>'store_name','')),trim(coalesce(details->>'reason','')),trim(coalesce(details->>'applicant_name','')),coalesce(details->>'organization_type',''),trim(coalesce(details->>'location','')),trim(coalesce(details->>'experience','')),trim(coalesce(details->>'intended_use','')),coalesce(details->>'expected_devices',''),coalesce(details->>'whatsapp',''),coalesce((details->>'whatsapp_consent')::boolean,false),coalesce((details->>'privacy_acknowledged')::boolean,false),1)
 returning * into application;
 return application;
end; $$;
revoke all on function public.submit_admin_application(jsonb) from public,anon;
grant execute on function public.submit_admin_application(jsonb) to authenticated;

create or replace function public.queue_application_email() returns trigger
 language plpgsql security definer set search_path='' as $$
declare target_email text;
begin
 if tg_op='INSERT' or new.status is distinct from old.status then
  select email into target_email from auth.users where id=new.user_id and email_confirmed_at is not null;
  if target_email is not null then
   insert into public.application_emails(application_id,user_id,recipient,event)
   values(new.id,new.user_id,target_email,new.status) on conflict(application_id,event) do nothing;
  end if;
 end if;
 return new;
end; $$;
revoke all on function public.queue_application_email() from public,anon,authenticated;
drop trigger if exists queue_application_email on public.admin_applications;
create trigger queue_application_email after insert or update of status on public.admin_applications
 for each row execute function public.queue_application_email();

-- Only the trusted worker can claim messages. Recipient and event come from the database.
create or replace function public.claim_application_emails(target_application uuid, actor_id uuid)
 returns setof public.application_emails language plpgsql set search_path='' as $$
begin
 if actor_id is not null and not exists(select 1 from public.admin_applications where id=target_application and user_id=actor_id)
 and not exists(select 1 from public.platform_admins where user_id=actor_id and role='owner' and is_active=true) then raise exception 'Accès refusé.'; end if;
 update public.application_emails e set status='skipped',last_error='Superseded by the current decision'
 from public.admin_applications a where e.application_id=a.id and e.status in ('pending','failed')
 and (e.event<>a.status or (e.event='approved' and not exists(select 1 from public.platform_admins p where p.user_id=e.user_id and p.role in ('admin','owner') and p.is_active=true))) and (target_application is null or a.id=target_application);
 return query with eligible as (
  select e.id from public.application_emails e
  where (target_application is null or e.application_id=target_application)
  and (actor_id is null or e.user_id=actor_id or exists(select 1 from public.platform_admins where user_id=actor_id and role='owner' and is_active=true))
  and e.attempts<5 and e.next_attempt_at<=now() and (e.status in ('pending','failed') or (e.status='sending' and e.lease_until<now()))
  order by e.created_at limit 5 for update skip locked
 ) update public.application_emails e set status='sending',attempts=e.attempts+1,lease_until=now()+interval '5 minutes'
 from eligible where e.id=eligible.id returning e.*;
end; $$;
revoke all on function public.claim_application_emails(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_application_emails(uuid,uuid) to service_role;
commit;
notify pgrst,'reload schema';
