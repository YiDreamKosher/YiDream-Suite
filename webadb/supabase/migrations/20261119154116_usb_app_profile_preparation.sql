-- Save the application selection during USB preparation, before approval.
begin;

alter table private.yd_device_policy
  add column if not exists usb_managed_packages text[] not null default '{}'
    check (cardinality(usb_managed_packages) <= 100);

create or replace function public.yd_admin_set_usb_app_profile(
  target_device uuid, profile text, allowed_packages text[], managed_packages text[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.yd_require_live_admin();
  device public.devices;
  current_policy private.yd_device_policy;
  chosen_profile text := profile;
  selected text[] := allowed_packages;
  managed text[] := managed_packages;
  affected text[];
  baseline constant text[] := array[
    'com.android.calculator2', 'com.google.android.calculator',
    'com.android.deskclock', 'com.google.android.deskclock',
    'com.android.calendar', 'com.google.android.calendar',
    'com.android.soundrecorder', 'com.google.android.apps.recorder',
    'com.android.notes', 'com.android.notepad', 'com.google.android.keep',
    'com.jtech.zemer', 'tfilon.tfilon', 'net.calj.android', 'com.rhmsoft.pulsar',
    'fm.jewishmusic.application', 'com.waze', 'app.kosherscan.kosher_scan'
  ];
  protected_packages constant text[] := array[
    'com.yidream.mdm', 'com.android.settings', 'com.android.systemui',
    'com.android.permissioncontroller', 'com.google.android.permissioncontroller',
    'com.android.packageinstaller', 'com.google.android.packageinstaller',
    'com.android.shell', 'com.android.phone', 'com.android.server.telecom',
    'com.android.providers.settings', 'com.android.providers.telephony',
    'com.android.webview', 'com.google.android.webview',
    'com.android.vending', 'com.amazon.venezia', 'com.sec.android.app.samsungapps',
    'com.huawei.appmarket', 'com.xiaomi.market', 'com.oppo.market', 'com.heytap.market',
    'com.bbk.appstore', 'com.vivo.appstore', 'org.fdroid.fdroid', 'com.aurora.store'
  ];
  next_apps jsonb;
  profile_changed boolean;
  next_web boolean;
  next_sites boolean;
  removed_grant boolean;
begin
  perform pg_advisory_xact_lock(673219843);
  device := private.yd_lock_admin_device(target_device);
  if device.configuration_status not in ('needs_configuration', 'configured') then
    raise exception 'DEVICE_NOT_AVAILABLE';
  end if;
  perform 1 from private.yd_usb_registrations r where r.device_id = device.id for share;
  if not found then
    raise exception 'USB_REGISTRATION_REQUIRED';
  end if;
  if chosen_profile is null or chosen_profile not in ('mp3', 'qin') then
    raise exception 'USB_PROFILE_INVALID_TYPE';
  end if;
  if selected is null or managed is null or cardinality(selected) > 100 or cardinality(managed) > 100
    or coalesce(array_ndims(selected), 1) <> 1 or coalesce(array_ndims(managed), 1) <> 1 then
    raise exception 'USB_PROFILE_INVALID_PACKAGES';
  end if;
  if array_position(selected, null) is not null or array_position(managed, null) is not null
    or cardinality(selected) <> (select count(distinct p) from unnest(selected) as p)
    or cardinality(managed) <> (select count(distinct p) from unnest(managed) as p)
    or not (selected <@ managed) or not (baseline <@ managed)
    or exists (select 1 from unnest(managed) as p where length(p) > 255
      or p !~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$') then
    raise exception 'USB_PROFILE_INVALID_PACKAGES';
  end if;
  if managed && protected_packages or 'com.android.chrome' = any(selected) then
    raise exception 'USB_PROFILE_APP_PROTECTED';
  end if;
  select array_agg(p order by p) into selected from unnest(selected) as p;
  selected := coalesce(selected, '{}'::text[]);
  select array_agg(p order by p) into managed from unnest(managed) as p;
  insert into private.yd_device_policy(device_id) values (device.id) on conflict do nothing;
  select p.* into current_policy from private.yd_device_policy p where p.device_id = device.id for update;
  if exists (select 1 from unnest(selected) as p where current_policy.apps->p = 'false'::jsonb) then
    raise exception 'USB_PROFILE_APP_DENIED';
  end if;
  -- Previously prepared extras remain related to this USB selection: removing
  -- one now writes an explicit deny rather than reopening it on the next sync.
  select array_agg(distinct p order by p) into affected
    from unnest(managed || current_policy.usb_managed_packages) as p;
  select current_policy.apps || jsonb_object_agg(p, p = any(selected)) into next_apps
    from unnest(affected) as p;
  delete from private.yd_scoped_request_grants g where g.device_id = device.id
    and g.request_kind = 'app' and g.target = any(affected) and not (g.target = any(selected));
  removed_grant := found;
  if (select count(*) from jsonb_object_keys(next_apps || private.yd_scoped_rules(device.id, 'app'))) > 100 then
    raise exception 'DEVICE_RULE_LIMIT';
  end if;
  profile_changed := current_policy.device_profile is distinct from chosen_profile;
  next_web := case when profile_changed then chosen_profile <> 'mp3'
    else coalesce(current_policy.web_enabled, chosen_profile <> 'mp3') end;
  next_sites := next_web and current_policy.site_requests_enabled;
  update private.yd_device_policy p set
    device_profile = chosen_profile,
    apps = next_apps,
    usb_managed_packages = managed,
    web_enabled = case when profile_changed then null else p.web_enabled end,
    app_store_enabled = case when profile_changed then null else p.app_store_enabled end,
    site_requests_enabled = next_sites,
    revision = p.revision + 1,
    apply_failed = false
  where p.device_id = device.id and (profile_changed or p.apps is distinct from next_apps
    or p.usb_managed_packages is distinct from managed or p.site_requests_enabled is distinct from next_sites
    or removed_grant);
  return private.yd_policy_json_v2(device.id);
end;
$$;

revoke all on function public.yd_admin_set_usb_app_profile(uuid, text, text[], text[]) from public, anon, authenticated;
grant execute on function public.yd_admin_set_usb_app_profile(uuid, text, text[], text[]) to authenticated;
notify pgrst, 'reload schema';
commit;
