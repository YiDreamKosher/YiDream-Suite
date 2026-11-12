-- Deliver the Chrome opt-in separately from legacy application permissions.
begin;

alter table private.yd_device_policy
  add column if not exists managed_chrome_enabled boolean not null default false,
  add column if not exists managed_chrome_disable_pending boolean not null default false,
  add column if not exists managed_chrome_status text
    check (managed_chrome_status in ('ready', 'active', 'unsupported', 'failed')),
  add column if not exists managed_chrome_reported_revision bigint,
  add column if not exists managed_chrome_reported_token_hash text;

-- Earlier clients interpret a generic allow as permission to open unfiltered Chrome.
update private.yd_device_policy
  set apps = jsonb_set(apps, '{com.android.chrome}', 'false'::jsonb),
    revision = revision + 1, apply_failed = false
  where apps->'com.android.chrome' = 'true'::jsonb;

create or replace function private.yd_reject_unmanaged_chrome() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.apps->'com.android.chrome' = 'true'::jsonb then
    raise exception 'MANAGED_CHROME_REQUIRED';
  end if;
  return new;
end;
$$;

create or replace trigger yd_reject_unmanaged_chrome
  before insert or update of apps on private.yd_device_policy
  for each row execute function private.yd_reject_unmanaged_chrome();

create or replace function private.yd_policy_json_v2(target_device uuid) returns jsonb
language sql stable set search_path = '' set timezone = 'UTC' as $$
  select private.yd_policy_json(target_device) || jsonb_build_object(
    'server_time', now(),
    'temporary_sites', coalesce((
      select jsonb_object_agg(r.host, r.expires_at)
      from private.yd_active_temporary_site_rules(target_device) r
    ), '{}'::jsonb),
    'managed_chrome', jsonb_build_object(
      'enabled', coalesce(p.managed_chrome_enabled, false),
      'status', case when l.device_id is not null then p.managed_chrome_status end,
      'reported_revision', case when l.device_id is not null then p.managed_chrome_reported_revision end
    )
  )
  from (select target_device as id) d
  left join private.yd_device_policy p on p.device_id = d.id
  left join public.yd_device_links l on l.device_id = d.id and l.token_hash = p.managed_chrome_reported_token_hash;
$$;

create or replace function public.yd_set_managed_chrome(target_device uuid, enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  device public.devices := private.yd_lock_admin_device(target_device);
  policy private.yd_device_policy;
  current_token_hash text;
begin
  if device.configuration_status <> 'configured' then
    raise exception 'CONFIGURED_DEVICE_REQUIRED';
  end if;
  if enabled is null then
    raise exception 'INVALID_DEVICE_RULE';
  end if;

  -- Use the same link-before-policy lock order as activation and device reports.
  select l.token_hash into current_token_hash
    from public.yd_device_links l where l.device_id = device.id for update;
  insert into private.yd_device_policy(device_id) values (device.id) on conflict do nothing;
  select p.* into policy from private.yd_device_policy p where p.device_id = device.id for update;
  if enabled = policy.managed_chrome_enabled then
    return private.yd_policy_json_v2(device.id);
  end if;
  if enabled and (current_token_hash is null
      or policy.managed_chrome_reported_token_hash is distinct from current_token_hash
      or coalesce(policy.managed_chrome_status, '') not in ('ready', 'active')) then
    raise exception 'MANAGED_CHROME_UNAVAILABLE';
  end if;
  if enabled and not (policy.apps ? 'com.android.chrome')
      and (select count(*) from jsonb_object_keys(policy.apps)) >= 100 then
    raise exception 'DEVICE_RULE_LIMIT';
  end if;

  update private.yd_device_policy p set
    managed_chrome_enabled = enabled,
    managed_chrome_disable_pending = not enabled,
    apps = jsonb_set(p.apps, '{com.android.chrome}', 'false'::jsonb),
    revision = p.revision + 1,
    apply_failed = false
  where p.device_id = device.id;
  return private.yd_policy_json_v2(device.id);
end;
$$;

create or replace function private.yd_record_device_policy(
  device_token text, policy_revision bigint, applied boolean, supports_windows boolean, chrome_status text
) returns void language plpgsql set search_path = '' as $$
declare
  device uuid := public.yd_require_device(device_token);
  credential_hash text := public.yd_token_hash(device_token);
  policy private.yd_device_policy;
  policy_applied boolean;
begin
  if policy_revision is null or policy_revision < 0 or applied is null
      or (chrome_status is not null and chrome_status not in ('ready', 'active', 'unsupported', 'failed')) then
    raise exception 'INVALID_POLICY_REPORT';
  end if;

  perform 1 from public.yd_device_links l where l.device_id = device and l.token_hash = credential_hash for update;
  if not found then
    raise exception 'APP_ACCESS_DENIED';
  end if;
  perform public.yd_require_device(device_token);
  insert into private.yd_device_policy(device_id) values (device) on conflict do nothing;
  select p.* into policy from private.yd_device_policy p where p.device_id = device for update;
  if policy.revision <> policy_revision then
    return;
  end if;
  -- A current legacy report can follow an app downgrade on the same credential.
  if chrome_status is null and policy.managed_chrome_reported_token_hash = credential_hash then
    update private.yd_device_policy p set
      managed_chrome_status = null,
      managed_chrome_reported_revision = null,
      managed_chrome_reported_token_hash = null
    where p.device_id = device;
  end if;
  if not supports_windows and exists (select 1 from private.yd_active_temporary_site_rules(device)) then
    return;
  end if;
  if chrome_status is null and (policy.managed_chrome_enabled or policy.managed_chrome_disable_pending) then
    return;
  end if;
  if (chrome_status = 'active' and not policy.managed_chrome_enabled)
      or (chrome_status = 'ready' and policy.managed_chrome_enabled) then
    raise exception 'INVALID_POLICY_REPORT';
  end if;

  policy_applied := applied and (chrome_status is distinct from 'failed')
    and (not policy.managed_chrome_enabled or chrome_status = 'active');
  update private.yd_device_policy p set
    applied_revision = case when policy_applied then policy_revision else p.applied_revision end,
    last_sync_at = now(),
    apply_failed = not policy_applied,
    managed_chrome_status = coalesce(chrome_status, p.managed_chrome_status),
    managed_chrome_reported_revision = case
      when chrome_status is not null then policy_revision else p.managed_chrome_reported_revision end,
    managed_chrome_reported_token_hash = case
      when chrome_status is not null then credential_hash else p.managed_chrome_reported_token_hash end,
    managed_chrome_disable_pending = p.managed_chrome_disable_pending and
      coalesce(chrome_status not in ('ready', 'unsupported'), true)
  where p.device_id = device;
end;
$$;

-- The previous RPCs share validation and cannot acknowledge a pending Chrome change.
create or replace function private.yd_record_device_policy(
  device_token text, policy_revision bigint, applied boolean, supports_windows boolean
) returns void language sql set search_path = '' as $$
  select private.yd_record_device_policy(device_token, policy_revision, applied, supports_windows, null::text);
$$;

create or replace function public.yd_get_device_policy_v3(device_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.yd_policy_json_v2(public.yd_require_device(device_token));
$$;

create or replace function public.yd_report_device_policy_v3(
  device_token text, policy_revision bigint, applied boolean, chrome_status text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if chrome_status is null then
    raise exception 'INVALID_POLICY_REPORT';
  end if;
  perform private.yd_record_device_policy(device_token, policy_revision, applied, true, chrome_status);
  return private.yd_policy_json_v2(public.yd_require_device(device_token));
end;
$$;

revoke all on function private.yd_reject_unmanaged_chrome(),
  private.yd_record_device_policy(text, bigint, boolean, boolean, text)
  from public, anon, authenticated;
revoke all on function public.yd_set_managed_chrome(uuid, boolean),
  public.yd_get_device_policy_v3(text), public.yd_report_device_policy_v3(text, bigint, boolean, text)
  from public, anon, authenticated;
grant execute on function public.yd_set_managed_chrome(uuid, boolean) to authenticated;
grant execute on function public.yd_get_device_policy_v3(text),
  public.yd_report_device_policy_v3(text, bigint, boolean, text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
