-- Integrate the Chrome pilot with the newer per-device section exceptions.
-- This migration only closes incompatible settings. It never enables a device.
begin;

update private.yd_device_policy p set
  managed_chrome_enabled = false,
  managed_chrome_disable_pending = true,
  apps = jsonb_set(p.apps, '{com.android.chrome}', 'false'::jsonb),
  revision = p.revision + 1,
  apply_failed = false
where p.managed_chrome_enabled and not private.yd_web_enabled(p.device_id);

create or replace function private.yd_guard_chrome_web_section() returns trigger
language plpgsql set search_path = '' as $$
declare
  web_enabled boolean := coalesce(new.web_enabled, new.device_profile is distinct from 'mp3');
begin
  if not web_enabled then
    -- Enabling Chrome while websites are closed is an invalid administrator
    -- operation. Closing websites or changing profile closes an existing pilot.
    if new.managed_chrome_enabled then
      if tg_op = 'INSERT' then
        raise exception 'WEB_SECTION_DISABLED';
      elsif not old.managed_chrome_enabled then
        raise exception 'WEB_SECTION_DISABLED';
      end if;
    end if;
    if tg_op = 'UPDATE' and old.managed_chrome_enabled then
      new.managed_chrome_enabled := false;
      new.managed_chrome_disable_pending := true;
      new.apps := jsonb_set(new.apps, '{com.android.chrome}', 'false'::jsonb);
      new.revision := greatest(new.revision, old.revision + 1);
      new.apply_failed := false;
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger yd_guard_chrome_web_section
  before insert or update of managed_chrome_enabled, web_enabled, device_profile
  on private.yd_device_policy
  for each row execute function private.yd_guard_chrome_web_section();

-- v3 adds the Chrome report to the current policy JSON. All MP3, request,
-- section visibility, application and temporary-site fields are preserved.
create or replace function private.yd_policy_json_v2(target_device uuid) returns jsonb
language sql stable set search_path = '' set timezone = 'UTC' as $$
  select private.yd_policy_json(target_device) || jsonb_build_object(
    'server_time', now(),
    'temporary_sites', coalesce((
      select jsonb_object_agg(r.host, r.expires_at)
      from private.yd_active_temporary_site_rules(target_device) r
    ), '{}'::jsonb),
    'managed_chrome', jsonb_build_object(
      'enabled', private.yd_web_enabled(target_device) and coalesce(p.managed_chrome_enabled, false),
      'status', case when l.device_id is not null then p.managed_chrome_status end,
      'reported_revision', case when l.device_id is not null then p.managed_chrome_reported_revision end
    )
  )
  from (select target_device as id) d
  left join private.yd_device_policy p on p.device_id = d.id
  left join public.yd_device_links l on l.device_id = d.id
    and l.token_hash = p.managed_chrome_reported_token_hash;
$$;

revoke all on function private.yd_guard_chrome_web_section() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
