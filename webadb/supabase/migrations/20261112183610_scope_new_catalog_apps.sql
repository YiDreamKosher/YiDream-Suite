begin;

-- Preserve published catalogue releases. New shop apps require a device grant.
alter table public.yd_catalog add column if not exists requires_device_approval boolean not null default false;
alter table public.yd_catalog alter column requires_device_approval set default true;

create or replace function private.yd_catalog_available(
  item public.yd_catalog, shop uuid, app_rules jsonb
) returns boolean language sql immutable set search_path = '' as $$
  select (item).enabled and ((item).is_base or ((item).owner_id = shop and (
    not (item).requires_device_approval or coalesce(app_rules -> (item).package_name = 'true'::jsonb, false)
  )));
$$;

create or replace function public.yd_device_catalog(device_token text)
returns setof public.yd_catalog language plpgsql stable security definer set search_path = '' as $$
declare
  target uuid := public.yd_require_device(device_token);
  app_rules jsonb := private.yd_policy_json(target)->'apps';
begin
  return query select distinct on (c.package_name) c.* from public.yd_catalog c
    join public.devices d on d.id = target
    where private.yd_catalog_available(c, d.user_id, app_rules)
    order by c.package_name, c.is_base desc, c.version_code desc nulls last, c.id;
end;
$$;

create or replace function public.yd_can_read_apk(object_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  token text := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb->>'x-yidream-device-token';
  target uuid := public.yd_require_device(token);
  app_rules jsonb := private.yd_policy_json(target)->'apps';
begin
  return exists (
    select 1 from public.yd_catalog c join public.devices d on d.id = target
    where c.storage_path = object_name and private.yd_catalog_available(c, d.user_id, app_rules)
  );
exception when others then return false;
end;
$$;

revoke all on function private.yd_catalog_available(public.yd_catalog, uuid, jsonb) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
