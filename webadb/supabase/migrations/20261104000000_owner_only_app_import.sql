-- APK import tools are reserved to the active owner (admin of administrators).
-- Re-runnable. Catalog visibility, metadata editing and Android downloads are preserved.
begin;
alter table public.platform_admins
  add column if not exists is_active boolean not null default true;

create or replace function public.is_platform_owner()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins
    where user_id = (select auth.uid()) and role = 'owner' and is_active = true
  );
$$;
revoke all on function public.is_platform_owner() from public, anon;
grant execute on function public.is_platform_owner() to authenticated;

drop policy if exists yd_apk_admin_insert on storage.objects;
drop policy if exists yd_apk_admin_update on storage.objects;
create policy yd_apk_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'yd-apks' and public.is_platform_owner());
create policy yd_apk_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'yd-apks' and public.is_platform_owner())
  with check (bucket_id = 'yd-apks' and public.is_platform_owner());
commit;
notify pgrst, 'reload schema';
