-- End-user access is separate from platform administrator roles and device-owner policy.
-- Requires the existing device/catalog and active-administrator migrations.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.yd_app_accounts (
 id uuid primary key default gen_random_uuid(),
 auth_user_id uuid unique references auth.users(id) on delete cascade,
 email text not null check(length(email) between 3 and 254 and email = lower(trim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 contact_phone text not null check(contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
 email_verified boolean not null default false,
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 last_seen_at timestamptz,
 constraint yd_app_account_verified_auth check(not email_verified or auth_user_id is not null)
);
alter table public.yd_app_accounts enable row level security;
revoke all on public.yd_app_accounts from public, anon, authenticated;
grant select on public.yd_app_accounts to authenticated;
drop policy if exists yd_app_account_own_read on public.yd_app_accounts;
create policy yd_app_account_own_read on public.yd_app_accounts for select to authenticated
 using(auth_user_id = (select auth.uid()));

alter table public.yd_device_links
 add column if not exists account_id uuid references public.yd_app_accounts(id),
 add column if not exists pairing_created_by uuid references auth.users(id) on delete set null,
 add column if not exists access_issuer_id uuid references auth.users(id) on delete set null,
 add column if not exists app_session_hash text,
 add column if not exists app_session_expires_at timestamptz;
create unique index if not exists yd_app_session_hash_unique on public.yd_device_links(app_session_hash) where app_session_hash is not null;
create index if not exists yd_device_account_index on public.yd_device_links(account_id);

-- Private helpers never expose contact information or tokens as an anonymous RPC.
create or replace function private.yd_account_json(account public.yd_app_accounts)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',account.id,'email',account.email,'contact_phone',account.contact_phone,
 'email_verified',account.email_verified,'is_active',account.is_active);
$$;
create or replace function private.yd_confirmed_app_account() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare account_id uuid;
begin
 select a.id into account_id from public.yd_app_accounts a join auth.users u on u.id=a.auth_user_id
 where u.id=auth.uid() and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
 and exists(select 1 from auth.sessions s where s.user_id=u.id and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>now()))
 and a.email=lower(u.email) and a.email_verified and a.is_active;
 if account_id is null then raise exception 'APP_ACCESS_DENIED'; end if;
 return account_id;
end; $$;
create or replace function private.yd_valid_device_issuer(issuer uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.platform_admins p join auth.users u on u.id=p.user_id
 where p.user_id=issuer and p.role in ('owner','admin') and p.is_active and (u.banned_until is null or u.banned_until<=now()));
$$;
revoke all on function private.yd_account_json(public.yd_app_accounts),private.yd_confirmed_app_account(),private.yd_valid_device_issuer(uuid) from public,anon,authenticated;

create or replace function public.yd_complete_app_profile(contact_phone text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare canonical_email text; account public.yd_app_accounts; device uuid;
begin
 if auth.uid() is null or contact_phone is null or contact_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'INVALID_CONTACT'; end if;
 select lower(email) into canonical_email from auth.users where id=auth.uid() and email_confirmed_at is not null
 and (banned_until is null or banned_until<=now())
 and exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>now()));
 if canonical_email is null then raise exception 'EMAIL_CONFIRMATION_REQUIRED'; end if;
 -- A code-only account is never merged merely because somebody typed the same email.
 select * into account from public.yd_app_accounts where auth_user_id=auth.uid() for update;
 if found and not account.is_active then raise exception 'APP_ACCESS_DENIED'; end if;
 insert into public.yd_app_accounts(auth_user_id,email,contact_phone,email_verified,last_seen_at)
 values(auth.uid(),canonical_email,contact_phone,true,now())
 on conflict(auth_user_id) do update set email=excluded.email,contact_phone=excluded.contact_phone,last_seen_at=excluded.last_seen_at
 returning * into account;
 select l.device_id into device from public.yd_device_links l join public.devices d on d.id=l.device_id
 where l.account_id=account.id and d.configuration_status='configured' and private.yd_valid_device_issuer(l.access_issuer_id)
 and (d.user_id=l.access_issuer_id or exists(select 1 from public.platform_admins where user_id=l.access_issuer_id and role='owner' and is_active))
 order by d.created_at desc limit 1;
 return jsonb_build_object('account',private.yd_account_json(account),'device_id',device,'expires_at',null);
end; $$;

create or replace function public.yd_create_pairing(target_device uuid) returns text
language plpgsql security definer set search_path='' as $$
declare code text;
begin
 perform pg_advisory_xact_lock(673219843);
 if auth.uid() is null or not public.is_platform_admin() or not exists(
 select 1 from public.devices where id=target_device and configuration_status='configured'
 and (public.is_platform_owner() or user_id=auth.uid())) then raise exception 'CONFIGURED_DEVICE_REQUIRED'; end if;
 code=upper(encode(extensions.gen_random_bytes(16),'hex'));
 insert into public.yd_device_links(device_id,pairing_hash,pairing_expires_at,pairing_created_by)
 values(target_device,public.yd_token_hash(code),now()+interval '15 minutes',auth.uid())
 on conflict(device_id) do update set pairing_hash=excluded.pairing_hash,pairing_expires_at=excluded.pairing_expires_at,pairing_created_by=excluded.pairing_created_by;
 -- Issuing a code does not interrupt the current phone session; redeeming it rotates access.
 return code;
end; $$;

create or replace function public.yd_pair_device(pairing_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare link public.yd_device_links; account public.yd_app_accounts; token text;
begin
 perform pg_advisory_xact_lock(673219843);
 select * into account from public.yd_app_accounts where id=private.yd_confirmed_app_account() for update;
 if not account.is_active then raise exception 'APP_ACCESS_DENIED'; end if;
 select l.* into link from public.yd_device_links l join public.devices d on d.id=l.device_id
 where l.pairing_hash=public.yd_token_hash(upper(trim(pairing_code))) and l.pairing_expires_at>now()
 and d.configuration_status='configured' and private.yd_valid_device_issuer(l.pairing_created_by)
 and (d.user_id=l.pairing_created_by or exists(select 1 from public.platform_admins where user_id=l.pairing_created_by and role='owner' and is_active)) for update of l;
 if link.device_id is null then raise exception 'INVALID_ACCOUNT_CODE'; end if;
 token=encode(extensions.gen_random_bytes(32),'hex');
 update public.yd_device_links set token_hash=public.yd_token_hash(token),account_id=account.id,access_issuer_id=link.pairing_created_by,
 pairing_hash=null,pairing_expires_at=null,pairing_created_by=null,app_session_hash=null,app_session_expires_at=null where device_id=link.device_id;
 return jsonb_build_object('account',private.yd_account_json(account),'device_id',link.device_id,'token',token);
end; $$;

create or replace function public.yd_activate_app_code(account_code text,contact_email text,contact_phone text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare link public.yd_device_links; account public.yd_app_accounts; token text; session_token text; expires timestamptz;
begin
 perform pg_advisory_xact_lock(673219843);
 if contact_email is null or length(trim(contact_email))>254 or trim(contact_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or contact_phone is null or contact_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'INVALID_CONTACT'; end if;
 if account_code is null or upper(trim(account_code)) !~ '^[0-9A-F]{32}$' then raise exception 'INVALID_ACCOUNT_CODE'; end if;
 select l.* into link from public.yd_device_links l join public.devices d on d.id=l.device_id
 where l.pairing_hash=public.yd_token_hash(upper(trim(account_code))) and l.pairing_expires_at>now()
 and d.configuration_status='configured' and private.yd_valid_device_issuer(l.pairing_created_by)
 and (d.user_id=l.pairing_created_by or exists(select 1 from public.platform_admins where user_id=l.pairing_created_by and role='owner' and is_active)) for update of l;
 if link.device_id is null then raise exception 'INVALID_ACCOUNT_CODE'; end if;
 insert into public.yd_app_accounts(email,contact_phone,email_verified,last_seen_at)
 values(lower(trim(contact_email)),contact_phone,false,now()) returning * into account;
 token=encode(extensions.gen_random_bytes(32),'hex');
 session_token=encode(extensions.gen_random_bytes(32),'hex'); expires=now()+interval '30 days';
 update public.yd_device_links set token_hash=public.yd_token_hash(token),account_id=account.id,access_issuer_id=link.pairing_created_by,
 pairing_hash=null,pairing_expires_at=null,pairing_created_by=null,app_session_hash=public.yd_token_hash(session_token),app_session_expires_at=expires where device_id=link.device_id;
 return jsonb_build_object('account',private.yd_account_json(account),'device_id',link.device_id,'token',token,'app_token',session_token,'expires_at',expires);
end; $$;

create or replace function public.yd_app_access_status(app_token text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare account public.yd_app_accounts; device uuid; expires timestamptz;
begin
 if app_token is not null then
 select l.device_id,l.app_session_expires_at into device,expires
 from public.yd_app_accounts a join public.yd_device_links l on l.account_id=a.id join public.devices d on d.id=l.device_id
 where a.auth_user_id is null and a.is_active and l.app_session_hash=public.yd_token_hash(app_token) and l.app_session_expires_at>now()
 and d.configuration_status='configured' and private.yd_valid_device_issuer(l.access_issuer_id)
 and (d.user_id=l.access_issuer_id or exists(select 1 from public.platform_admins where user_id=l.access_issuer_id and role='owner' and is_active));
 select a.* into account from public.yd_app_accounts a join public.yd_device_links l on l.account_id=a.id where l.device_id=device;
 else
 select * into account from public.yd_app_accounts where id=private.yd_confirmed_app_account();
 select l.device_id into device from public.yd_device_links l join public.devices d on d.id=l.device_id where l.account_id=account.id
 and d.configuration_status='configured' and private.yd_valid_device_issuer(l.access_issuer_id)
 and (d.user_id=l.access_issuer_id or exists(select 1 from public.platform_admins where user_id=l.access_issuer_id and role='owner' and is_active)) order by d.created_at desc limit 1;
 end if;
 if account.id is null then raise exception 'APP_ACCESS_DENIED'; end if;
 update public.yd_app_accounts set last_seen_at=now() where id=account.id;
 return jsonb_build_object('account',private.yd_account_json(account),'device_id',device,'expires_at',expires);
end; $$;

create or replace function public.yd_logout_app_session(app_token text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if app_token is not null then
 update public.yd_device_links set app_session_hash=null,app_session_expires_at=null where app_session_hash=public.yd_token_hash(app_token);
 end if;
end; $$;

create or replace function public.yd_require_device(device_token text) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare link public.yd_device_links; account public.yd_app_accounts; supplied_session text;
begin
 select l.* into link from public.yd_device_links l join public.yd_app_accounts a on a.id=l.account_id
 join public.devices d on d.id=l.device_id where l.token_hash=public.yd_token_hash(device_token)
 and a.is_active and d.configuration_status='configured' and private.yd_valid_device_issuer(l.access_issuer_id)
 and (d.user_id=l.access_issuer_id or exists(select 1 from public.platform_admins where user_id=l.access_issuer_id and role='owner' and is_active));
 if link.device_id is null then raise exception 'APP_ACCESS_DENIED'; end if;
 select * into account from public.yd_app_accounts where id=link.account_id;
 if auth.uid() is not null and account.auth_user_id=auth.uid() and account.id=private.yd_confirmed_app_account() then return link.device_id; end if;
 supplied_session=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-yidream-app-token';
 if account.auth_user_id is null and link.app_session_expires_at>now() and link.app_session_hash=public.yd_token_hash(supplied_session) then return link.device_id; end if;
 raise exception 'APP_ACCESS_DENIED';
end; $$;

create or replace function public.yd_can_read_apk(object_name text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare device uuid; token text;
begin
 token=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-yidream-device-token';
 device=public.yd_require_device(token);
 return exists(select 1 from public.yd_catalog c join public.devices d on d.id=device
 where c.enabled and c.storage_path=object_name and (c.is_base or c.owner_id=d.user_id));
exception when others then return false;
end; $$;

create or replace function public.yd_list_app_accounts() returns table(
 id uuid,email text,contact_phone text,email_verified boolean,is_active boolean,device_id uuid,device_name text,
 created_at timestamptz,last_seen_at timestamptz,can_manage boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_platform_admin() then raise exception 'APP_ACCESS_DENIED'; end if;
 return query select a.id,a.email,a.contact_phone,a.email_verified,a.is_active,d.id,d.name,a.created_at,a.last_seen_at,
 (public.is_platform_owner() or not exists(select 1 from public.yd_device_links other_link join public.devices other_device on other_device.id=other_link.device_id where other_link.account_id=a.id and other_device.user_id<>auth.uid()))
 from public.yd_app_accounts a join public.yd_device_links l on l.account_id=a.id join public.devices d on d.id=l.device_id
 where public.is_platform_owner() or d.user_id=auth.uid() order by a.created_at desc,d.name;
end; $$;

create or replace function public.yd_set_app_account_access(target_account uuid,enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(673219843);
 if enabled is null or auth.uid() is null or not public.is_platform_admin() then raise exception 'APP_ACCESS_DENIED'; end if;
 -- Lock the account so pairing and access changes cannot race across shops.
 perform 1 from public.yd_app_accounts where id=target_account for update;
 if not found then raise exception 'APP_ACCESS_DENIED'; end if;
 if not public.is_platform_owner() and (not exists(select 1 from public.yd_device_links l join public.devices d on d.id=l.device_id where l.account_id=target_account and d.user_id=auth.uid())
 or exists(select 1 from public.yd_device_links l join public.devices d on d.id=l.device_id where l.account_id=target_account and d.user_id<>auth.uid())) then raise exception 'APP_ACCESS_DENIED'; end if;
 update public.yd_app_accounts set is_active=enabled where id=target_account;
 if not enabled then
 update public.yd_device_links set pairing_hash=null,pairing_expires_at=null,pairing_created_by=null where account_id=target_account;
 end if;
end; $$;

revoke all on function public.yd_complete_app_profile(text),public.yd_create_pairing(uuid),public.yd_pair_device(text),public.yd_activate_app_code(text,text,text),public.yd_app_access_status(text),public.yd_logout_app_session(text),public.yd_require_device(text),public.yd_can_read_apk(text),public.yd_list_app_accounts(),public.yd_set_app_account_access(uuid,boolean) from public,anon,authenticated;
grant execute on function public.yd_complete_app_profile(text),public.yd_create_pairing(uuid),public.yd_pair_device(text),public.yd_list_app_accounts(),public.yd_set_app_account_access(uuid,boolean) to authenticated;
grant execute on function public.yd_activate_app_code(text,text,text),public.yd_app_access_status(text),public.yd_logout_app_session(text),public.yd_can_read_apk(text) to anon,authenticated;
-- Existing device APIs remain callable but now enforce both enrollment and app-account access.
grant execute on function public.yd_device_catalog(text),public.yd_device_requests(text),public.yd_request_site(text,text,text,uuid) to authenticated;

-- Passwordless email delivery budget: service-only, hashed identifiers and serialized quotas.
create table if not exists private.yd_app_auth_budget (
 scope text not null check(scope in ('email','ip','global')),
 identifier_hash text not null check(identifier_hash ~ '^[0-9a-f]{64}$'),
 last_attempt_at timestamptz not null,
 window_start timestamptz not null,
 attempts integer not null check(attempts>0),
 primary key(scope,identifier_hash)
);
alter table private.yd_app_auth_budget enable row level security;
revoke all on private.yd_app_auth_budget from public,anon,authenticated;
create or replace function public.yd_claim_app_auth_email(email_hash text,ip_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare email_row private.yd_app_auth_budget; ip_row private.yd_app_auth_budget; global_row private.yd_app_auth_budget;
 constant_global text:=repeat('0',64);
begin
 if email_hash is null or email_hash !~ '^[0-9a-f]{64}$' or ip_hash is null or ip_hash !~ '^[0-9a-f]{64}$' then return false; end if;
 -- One lock serializes the small public-mail budget and makes parallel quota checks atomic.
 perform pg_advisory_xact_lock(673219842);
 delete from private.yd_app_auth_budget where last_attempt_at<now()-interval '2 days';
 select * into email_row from private.yd_app_auth_budget where scope='email' and identifier_hash=email_hash;
 select * into ip_row from private.yd_app_auth_budget where scope='ip' and identifier_hash=ip_hash;
 select * into global_row from private.yd_app_auth_budget where scope='global' and identifier_hash=constant_global;
 if email_row.last_attempt_at>now()-interval '60 seconds' or (email_row.window_start>now()-interval '1 day' and email_row.attempts>=5)
 or (ip_row.window_start>now()-interval '1 hour' and ip_row.attempts>=15)
 or (global_row.window_start>now()-interval '1 day' and global_row.attempts>=100) then return false; end if;
 insert into private.yd_app_auth_budget(scope,identifier_hash,last_attempt_at,window_start,attempts)
 values('email',email_hash,now(),now(),1),('ip',ip_hash,now(),now(),1),('global',constant_global,now(),now(),1)
 on conflict(scope,identifier_hash) do update set last_attempt_at=now(),
 attempts=case when yd_app_auth_budget.window_start<=now()-(case when excluded.scope='ip' then interval '1 hour' else interval '1 day' end) then 1 else yd_app_auth_budget.attempts+1 end,
 window_start=case when yd_app_auth_budget.window_start<=now()-(case when excluded.scope='ip' then interval '1 hour' else interval '1 day' end) then now() else yd_app_auth_budget.window_start end;
 return true;
end; $$;
revoke all on function public.yd_claim_app_auth_email(text,text) from public,anon,authenticated;
grant execute on function public.yd_claim_app_auth_email(text,text) to service_role;
commit;
notify pgrst, 'reload schema';
