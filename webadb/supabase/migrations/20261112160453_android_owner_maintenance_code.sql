-- Expose the current Android maintenance code without returning the provisioning key.
begin;

create or replace function public.get_android_maintenance_code()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  material jsonb;
begin
  perform private.yd_require_live_admin();
  if not public.is_platform_owner() then
    raise exception 'APP_ACCESS_DENIED';
  end if;

  material := public.get_android_unlock_material();
  return jsonb_build_object('code', material->>'code', 'date', material->>'date');
end;
$$;

revoke all on function public.get_android_maintenance_code() from public, anon, authenticated;
grant execute on function public.get_android_maintenance_code() to authenticated;

notify pgrst, 'reload schema';

commit;
