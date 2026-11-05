-- Adds shared base applications, versioned releases, scoped private APK storage and revocation.
-- Re-runnable. Run after 20261029000000_mdm_catalog_and_site_requests.sql.
begin;
alter table public.yd_catalog add column if not exists is_base boolean not null default false,
 add column if not exists version_code bigint check(version_code>0),
 add column if not exists version_name text,
 add column if not exists source_url text check(source_url is null or source_url like 'https://%'),
 add column if not exists storage_path text;
alter table public.yd_catalog alter column apk_url drop not null, alter column sha256 drop not null;
alter table public.yd_catalog drop constraint if exists yd_catalog_storage_owner;
alter table public.yd_catalog add constraint yd_catalog_storage_owner check(storage_path is null or split_part(storage_path,'/',1)=owner_id::text);
alter table public.yd_catalog drop constraint if exists yd_catalog_release_pair;
alter table public.yd_catalog add constraint yd_catalog_release_pair check((apk_url is null and sha256 is null) or (apk_url is not null and sha256 is not null));
alter table public.yd_site_requests drop constraint if exists yd_site_requests_status_check;
alter table public.yd_site_requests add constraint yd_site_requests_status_check check(status in ('pending','approved','rejected','revoked'));
drop policy if exists yd_catalog_admin on public.yd_catalog;
drop policy if exists yd_catalog_read on public.yd_catalog;
drop policy if exists yd_catalog_write on public.yd_catalog;
create policy yd_catalog_read on public.yd_catalog for select to authenticated
 using(public.is_platform_admin() and (is_base or owner_id=auth.uid() or public.is_platform_owner()));
create policy yd_catalog_write on public.yd_catalog for all to authenticated
 using(public.is_platform_owner() or (public.is_platform_admin() and owner_id=auth.uid() and not is_base))
 with check(public.is_platform_owner() or (public.is_platform_admin() and owner_id=auth.uid() and not is_base));
create or replace function public.yd_device_catalog(device_token text) returns setof public.yd_catalog language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 target=public.yd_require_device(device_token);
 return query select distinct on(c.package_name) c.* from public.yd_catalog c join public.devices d on d.id=target
 where c.enabled and (c.is_base or c.owner_id=d.user_id)
 order by c.package_name,c.is_base desc,c.version_code desc nulls last,c.id;
end; $$;
create or replace function public.yd_review_site(request_id uuid,decision text,note text default '') returns void language plpgsql security definer set search_path='' as $$
begin
 if decision is null or decision not in ('approved','rejected','revoked') then raise exception 'Décision invalide.'; end if;
 update public.yd_site_requests r set status=decision,admin_note=coalesce(note,''),reviewed_at=now(),reviewed_by=auth.uid()
 where r.id=request_id and ((r.status='pending' and decision in ('approved','rejected')) or (r.status='approved' and decision='revoked') or (r.status='revoked' and decision='approved'))
 and (public.is_platform_owner() or (public.is_platform_admin() and exists(select 1 from public.devices d where d.id=r.device_id and d.user_id=auth.uid())));
 if not found then raise exception 'Demande inaccessible ou décision déjà appliquée.'; end if;
end; $$;
-- Only platform owners publish the base catalog; already published APKs are preserved on reruns.
do $$ declare owner uuid; begin
 select user_id into owner from public.platform_admins where role='owner' order by user_id limit 1;
 if owner is not null then
 insert into public.yd_catalog(owner_id,name,description,package_name,is_base,source_url) values
 (owner,'WhatsApp','Messagerie et appels.','com.whatsapp',true,'https://play.google.com/store/apps/details?id=com.whatsapp'),
 (owner,'CalJ','Calendrier juif, fêtes et horaires.','net.calj.android',true,'https://play.google.com/store/apps/details?id=net.calj.android'),
 (owner,'Tfilon','Siddour et prières au quotidien.','tfilon.tfilon',true,'https://play.google.com/store/apps/details?id=tfilon.tfilon'),
 (owner,'Waze','Navigation et itinéraires.','com.waze',true,'https://play.google.com/store/apps/details?id=com.waze'),
 (owner,'Kosher Scan','Scanner et rechercher des produits casher.','app.kosherscan.kosher_scan',true,'https://play.google.com/store/apps/details?id=app.kosherscan.kosher_scan')
 on conflict(owner_id,package_name) do update set is_base=true,source_url=coalesce(yd_catalog.source_url,excluded.source_url);
 end if;
end; $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('yd-apks','yd-apks',false,262144000,array['application/vnd.android.package-archive','application/octet-stream','application/zip'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create or replace function public.yd_can_read_apk(object_name text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.yd_catalog c join public.devices d on (c.is_base or c.owner_id=d.user_id)
 join public.yd_device_links l on l.device_id=d.id
 where c.enabled and c.storage_path=object_name
 and l.token_hash=public.yd_token_hash(current_setting('request.headers',true)::jsonb->>'x-yidream-device-token'));
$$;
revoke all on function public.yd_can_read_apk(text) from public;
grant execute on function public.yd_can_read_apk(text) to anon,authenticated;
drop policy if exists yd_apk_admin_read on storage.objects;
drop policy if exists yd_apk_device_read on storage.objects;
drop policy if exists yd_apk_admin_insert on storage.objects;
drop policy if exists yd_apk_admin_update on storage.objects;
create policy yd_apk_admin_read on storage.objects for select to authenticated
 using(bucket_id='yd-apks' and public.is_platform_admin() and (split_part(name,'/',1)=auth.uid()::text or public.is_platform_owner()));
create policy yd_apk_device_read on storage.objects for select to anon,authenticated
 using(bucket_id='yd-apks' and public.yd_can_read_apk(name));
create policy yd_apk_admin_insert on storage.objects for insert to authenticated
 with check(bucket_id='yd-apks' and public.is_platform_admin() and (split_part(name,'/',1)=auth.uid()::text or public.is_platform_owner()));
create policy yd_apk_admin_update on storage.objects for update to authenticated
 using(bucket_id='yd-apks' and public.is_platform_admin() and (split_part(name,'/',1)=auth.uid()::text or public.is_platform_owner()))
 with check(bucket_id='yd-apks' and public.is_platform_admin() and (split_part(name,'/',1)=auth.uid()::text or public.is_platform_owner()));
commit;
notify pgrst, 'reload schema';
