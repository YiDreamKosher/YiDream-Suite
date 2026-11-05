-- Requires the existing YiDream devices table and platform administrator roles.
-- Safe to re-run: existing devices, tokens, catalog and requests are preserved.
-- Device tokens grant access only to one device's requests and its assigned shop's catalog.
begin;
create table if not exists public.yd_device_links (
 device_id uuid primary key references public.devices(id) on delete cascade,
 token_hash text unique,
 pairing_hash text unique,
 pairing_expires_at timestamptz
);
alter table public.yd_device_links enable row level security;
revoke all on public.yd_device_links from anon, authenticated;

create table if not exists public.yd_site_requests (
 id uuid primary key default gen_random_uuid(),
 device_id uuid not null references public.devices(id) on delete cascade,
 client_request_id uuid not null,
 site_url text not null check (length(site_url) <= 2048 and site_url ~ '^https://[^/@[:space:]]+\.[^/@[:space:]]+'),
 reason text not null default '' check (length(reason) <= 2000),
 status text not null default 'pending' check (status in ('pending','approved','rejected')),
 admin_note text not null default '' check (length(admin_note) <= 2000),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by uuid references auth.users(id),
 unique(device_id,client_request_id)
);
create index if not exists yd_requests_device_date on public.yd_site_requests(device_id,created_at desc);
create table if not exists public.yd_catalog (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id),
 name text not null check(length(name) between 1 and 100),
 description text not null default '' check(length(description) <= 1000),
 package_name text not null check(package_name ~ '^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$'),
 apk_url text not null check(apk_url ~ '^https://[^/@[:space:]]+/' and length(apk_url) <= 2048),
 sha256 text not null check(sha256 ~ '^[0-9a-fA-F]{64}$'),
 enabled boolean not null default true,
 unique(owner_id,package_name)
);
alter table public.yd_site_requests enable row level security;
alter table public.yd_catalog enable row level security;
revoke all on public.yd_site_requests,public.yd_catalog from anon,authenticated;
grant select on public.yd_site_requests to authenticated;
grant select,insert,update,delete on public.yd_catalog to authenticated;
drop policy if exists yd_requests_admin_read on public.yd_site_requests;
create policy yd_requests_admin_read on public.yd_site_requests for select to authenticated
 using (public.is_platform_owner() or (public.is_platform_admin() and exists(select 1 from public.devices d where d.id=device_id and d.user_id=auth.uid())));
drop policy if exists yd_catalog_admin on public.yd_catalog;
create policy yd_catalog_admin on public.yd_catalog for all to authenticated
 using(public.is_platform_owner() or (public.is_platform_admin() and owner_id=auth.uid()))
 with check(public.is_platform_owner() or (public.is_platform_admin() and owner_id=auth.uid()));

create or replace function public.yd_token_hash(value text) returns text language sql immutable strict set search_path='' as $$
 select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(value,'UTF8')),'hex');
$$;
create or replace function public.yd_require_device(device_token text) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 select device_id into target from public.yd_device_links where token_hash=public.yd_token_hash(device_token);
 if target is null then raise exception 'Association invalide.'; end if;
 return target;
end; $$;
revoke all on function public.yd_token_hash(text), public.yd_require_device(text) from public,anon,authenticated;

create or replace function public.yd_create_pairing(target_device uuid) returns text language plpgsql security definer set search_path='' as $$
declare code text;
begin
 if not (public.is_platform_owner() or (public.is_platform_admin() and exists(select 1 from public.devices where id=target_device and user_id=auth.uid()))) then raise exception 'Accès refusé.'; end if;
 code=upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
 insert into public.yd_device_links(device_id,pairing_hash,pairing_expires_at)
 values(target_device,public.yd_token_hash(code),now()+interval '15 minutes')
 on conflict(device_id) do update set pairing_hash=excluded.pairing_hash,pairing_expires_at=excluded.pairing_expires_at;
 return code;
end; $$;
create or replace function public.yd_pair_device(pairing_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid; token text;
begin
 select device_id into target from public.yd_device_links
 where pairing_hash=public.yd_token_hash(upper(trim(pairing_code))) and pairing_expires_at>now() for update;
 if target is null then raise exception 'Code invalide ou expiré.'; end if;
 token=gen_random_uuid()::text;
 update public.yd_device_links set token_hash=public.yd_token_hash(token),pairing_hash=null,pairing_expires_at=null where device_id=target;
 return jsonb_build_object('device_id',target,'token',token);
end; $$;
create or replace function public.yd_device_catalog(device_token text) returns setof public.yd_catalog language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 target=public.yd_require_device(device_token);
 return query select c.* from public.yd_catalog c join public.devices d on d.user_id=c.owner_id where d.id=target and c.enabled order by c.name;
end; $$;
create or replace function public.yd_device_requests(device_token text) returns setof public.yd_site_requests language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 target=public.yd_require_device(device_token);
 return query select * from public.yd_site_requests where device_id=target order by created_at desc limit 100;
end; $$;
create or replace function public.yd_request_site(device_token text,site_url text,request_reason text,client_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid; request_id uuid;
begin
 target=public.yd_require_device(device_token);
 if exists(select 1 from public.yd_site_requests r where r.device_id=target and r.client_request_id=yd_request_site.client_request_id) then return '{}'::jsonb; end if;
 -- Lock the device row to prevent parallel calls bypassing the daily request limit.
 perform 1 from public.yd_device_links where device_id=target for update;
 if (select count(*) from public.yd_site_requests where device_id=target and created_at>now()-interval '1 day') >= 20 then raise exception 'Limite quotidienne atteinte.'; end if;
 insert into public.yd_site_requests(device_id,client_request_id,site_url,reason)
 values(target,client_request_id,site_url,coalesce(request_reason,''))
 on conflict on constraint yd_site_requests_device_id_client_request_id_key do nothing;
 return '{}'::jsonb;
end; $$;
create or replace function public.yd_review_site(request_id uuid,decision text,note text default '') returns void language plpgsql security definer set search_path='' as $$
begin
 if decision not in ('approved','rejected') then raise exception 'Décision invalide.'; end if;
 update public.yd_site_requests r set status=decision,admin_note=coalesce(note,''),reviewed_at=now(),reviewed_by=auth.uid()
 where r.id=request_id and r.status='pending' and
 (public.is_platform_owner() or (public.is_platform_admin() and exists(select 1 from public.devices d where d.id=r.device_id and d.user_id=auth.uid())));
 if not found then raise exception 'Demande inaccessible ou déjà traitée.'; end if;
end; $$;
revoke all on function public.yd_create_pairing(uuid),public.yd_pair_device(text),public.yd_device_catalog(text),public.yd_device_requests(text),public.yd_request_site(text,text,text,uuid),public.yd_review_site(uuid,text,text) from public;
grant execute on function public.yd_create_pairing(uuid),public.yd_review_site(uuid,text,text) to authenticated;
grant execute on function public.yd_pair_device(text),public.yd_device_catalog(text),public.yd_device_requests(text),public.yd_request_site(text,text,text,uuid) to anon;
commit;
