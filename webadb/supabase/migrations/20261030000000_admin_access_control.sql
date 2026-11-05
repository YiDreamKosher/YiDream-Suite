-- Reversible, owner-only suspension for YiDream administrators.
-- Apply after 20261007000000_owner_admin_portal.sql.
alter table public.platform_admins
  add column if not exists is_active boolean not null default true,
  add column if not exists access_updated_at timestamptz,
  add column if not exists access_updated_by uuid references auth.users(id) on delete set null;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins
    where user_id = (select auth.uid())
      and role in ('owner', 'admin')
      and is_active = true
  );
$$;

create or replace function public.is_platform_owner()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins
    where user_id = (select auth.uid())
      and role = 'owner'
      and is_active = true
  );
$$;

revoke all on function public.is_platform_admin() from public;
revoke all on function public.is_platform_owner() from public;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_platform_owner() to authenticated;

-- Owners and admins keep access to their own role row so the frontend can show
-- the suspended screen; protected business tables still require is_platform_admin().
drop policy if exists "profile visible to account or owner" on public.reseller_profiles;
create policy "profile visible to active account or owner"
  on public.reseller_profiles for select to authenticated
  using ((user_id = (select auth.uid()) and public.is_platform_admin()) or public.is_platform_owner());

-- All role mutations now go through SECURITY DEFINER RPCs, which enforce owner
-- checks and write the audit log.
revoke insert, update, delete on public.platform_admins from authenticated;
revoke insert, update, delete on public.platform_admins from anon, public;
grant select on public.platform_admins to authenticated;

create or replace function public.set_platform_admin_access(target_user_id uuid, enabled boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  target_role text;
  target_email text;
  current_active boolean;
begin
  if not public.is_platform_owner() then
    raise exception 'Seul le propriétaire YiDream peut suspendre ou rétablir un administrateur.';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'Le propriétaire ne peut pas suspendre son propre accès.';
  end if;

  select role, email, is_active
    into target_role, target_email, current_active
  from public.platform_admins
  where user_id = target_user_id
  for update;

  if not found then
    raise exception 'Compte administrateur introuvable.';
  end if;
  if target_role <> 'admin' then
    raise exception 'Seul un compte administrateur peut être suspendu ou rétabli.';
  end if;
  if current_active = enabled then
    return;
  end if;

  update public.platform_admins
    set is_active = enabled,
        access_updated_at = now(),
        access_updated_by = auth.uid()
  where user_id = target_user_id;

  insert into public.activity_logs(user_id, action)
  values (
    auth.uid(),
    case when enabled then 'Accès administrateur rétabli : ' else 'Accès administrateur suspendu : ' end
      || coalesce(target_email, target_user_id::text)
  );
end;
$$;

revoke all on function public.set_platform_admin_access(uuid, boolean) from public, anon;
grant execute on function public.set_platform_admin_access(uuid, boolean) to authenticated;

-- A suspended admin may have an unexpired Supabase auth token, but RLS checks
-- is_platform_admin() on each protected request and rejects it immediately.
notify pgrst, 'reload schema';
