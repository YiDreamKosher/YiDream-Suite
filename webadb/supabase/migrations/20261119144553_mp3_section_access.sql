begin;

-- NULL inherits the profile default. Only the protected administrator RPC can
-- set an exception. Existing MP3 devices remain closed until explicitly opened.
alter table private.yd_device_policy
  add column if not exists web_enabled boolean,
  add column if not exists app_store_enabled boolean;

create or replace function private.yd_web_enabled(target_device uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select coalesce(p.web_enabled, p.device_profile is distinct from 'mp3')
    from private.yd_device_policy p where p.device_id = target_device), true);
$$;

create or replace function private.yd_policy_json(target_device uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'revision', coalesce(p.revision, 0),
    'apps', coalesce(p.apps, '{}'::jsonb) || private.yd_scoped_rules(target_device, 'app'),
    'sites', case when not private.yd_web_enabled(target_device) then '{}'::jsonb
      else coalesce(p.sites, '{}'::jsonb) || private.yd_scoped_rules(target_device, 'site') end,
    'applied_revision', coalesce(p.applied_revision, 0),
    'last_sync_at', p.last_sync_at,
    'apply_failed', coalesce(p.apply_failed, false),
    'device_profile', p.device_profile,
    'app_requests_enabled', coalesce(p.app_requests_enabled, false),
    'web_enabled', private.yd_web_enabled(target_device),
    'app_store_enabled', coalesce(p.app_store_enabled, p.device_profile is distinct from 'mp3'),
    'site_requests_enabled', private.yd_web_enabled(target_device)
      and coalesce(p.site_requests_enabled, false)
  )
  from (select target_device as id) d left join private.yd_device_policy p on p.device_id = d.id;
$$;

create or replace function private.yd_active_temporary_site_rules(target_device uuid)
returns setof private.yd_temporary_site_rules language sql stable set search_path = '' as $$
  with eligible as (
    select target_device as id where private.yd_web_enabled(target_device)
  ), active as (
    select r.device_id, r.host, r.expires_at, r.source_request_id
    from private.yd_temporary_site_rules r join eligible e on e.id = r.device_id
    where r.expires_at > now() and (r.source_request_id is null or exists (
      select 1 from public.yd_site_requests s join public.yd_device_links l
        on l.device_id = s.device_id and l.account_id = s.requested_account_id
      where s.id = r.source_request_id
    ))
    union all
    select g.device_id, g.target, g.expires_at, g.request_id
    from private.yd_scoped_request_grants g join eligible e on e.id = g.device_id
    join public.yd_site_requests s on s.id = g.request_id and s.status = 'approved'
    join public.yd_device_links l on l.device_id = s.device_id and l.account_id = s.requested_account_id
    where g.request_kind = 'site' and g.expires_at > now()
  )
  select distinct on (a.host) a.device_id, a.host, a.expires_at, a.source_request_id
  from active a order by a.host, a.expires_at desc;
$$;

create or replace function private.yd_write_device_controls(
  target_device uuid, profile text, set_profile boolean, allow_apps boolean, allow_sites boolean
) returns void language plpgsql set search_path = '' as $$
declare
  current_policy private.yd_device_policy;
  profile_changed boolean;
  next_profile text;
  next_web boolean;
  next_sites boolean;
begin
  insert into private.yd_device_policy(device_id) values (target_device) on conflict do nothing;
  select p.* into current_policy from private.yd_device_policy p where p.device_id = target_device for update;
  profile_changed := set_profile and current_policy.device_profile is distinct from profile;
  next_profile := case when set_profile then profile else current_policy.device_profile end;
  next_web := case when profile_changed then next_profile is distinct from 'mp3'
    else coalesce(current_policy.web_enabled, next_profile is distinct from 'mp3') end;
  next_sites := next_web and coalesce(allow_sites, current_policy.site_requests_enabled);
  update private.yd_device_policy p set
    device_profile = next_profile,
    web_enabled = case when profile_changed then null else p.web_enabled end,
    app_store_enabled = case when profile_changed then null else p.app_store_enabled end,
    app_requests_enabled = coalesce(allow_apps, p.app_requests_enabled),
    site_requests_enabled = next_sites,
    revision = p.revision + 1, apply_failed = false
  where p.device_id = target_device and (
    profile_changed
    or (allow_apps is not null and p.app_requests_enabled is distinct from allow_apps)
    or p.site_requests_enabled is distinct from next_sites
  );
end;
$$;

create or replace function public.yd_admin_set_request_permissions(
  target_devices uuid[], app_requests_enabled boolean, site_requests_enabled boolean
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  target uuid;
  device public.devices;
  affected integer := 0;
begin
  perform private.yd_require_live_admin();
  if coalesce(cardinality(target_devices), 0) = 0 or array_position(target_devices, null) is not null
    or (app_requests_enabled is null and site_requests_enabled is null) then
    raise exception 'INVALID_DEVICE_CONTROLS';
  end if;
  perform pg_advisory_xact_lock(673219843);
  for target in select distinct u.id from unnest(target_devices) as u(id) order by u.id loop
    device := private.yd_lock_admin_device(target);
    if device.configuration_status <> 'configured' then
      raise exception 'CONFIGURED_DEVICE_REQUIRED';
    end if;
    if site_requests_enabled is true and not private.yd_web_enabled(target) then
      raise exception 'WEB_SECTION_DISABLED';
    end if;
    perform private.yd_write_device_controls(target, null, false, app_requests_enabled, site_requests_enabled);
    affected := affected + 1;
  end loop;
  return affected;
end;
$$;

create or replace function private.yd_enforce_request_permission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  policy private.yd_device_policy;
begin
  insert into private.yd_device_policy(device_id) values (new.device_id) on conflict do nothing;
  select p.* into policy from private.yd_device_policy p where p.device_id = new.device_id for share;
  if tg_table_name = 'yd_app_access_requests' then
    if not policy.app_requests_enabled then raise exception 'REQUESTS_DISABLED'; end if;
  else
    if not policy.site_requests_enabled or not coalesce(policy.web_enabled, policy.device_profile is distinct from 'mp3') then
      raise exception 'REQUESTS_DISABLED';
    end if;
    if new.requested_account_id is null then
      select l.account_id into new.requested_account_id from public.yd_device_links l
      where l.device_id = new.device_id;
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.yd_guard_site_approval() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'approved' and old.status is distinct from new.status then
    if not private.yd_web_enabled(new.device_id) then
      raise exception 'WEB_SECTION_DISABLED';
    end if;
    if new.requested_account_id is not null and not exists (
      select 1 from public.yd_device_links l join public.yd_app_accounts a on a.id = l.account_id
      where l.device_id = new.device_id and l.account_id = new.requested_account_id and a.is_active
    ) then
      raise exception 'SITE_REQUEST_NOT_AVAILABLE';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.yd_set_device_rule(target_device uuid, rule_kind text, rule_target text, allowed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  device public.devices;
  removed boolean;
begin
  perform pg_advisory_xact_lock(673219843);
  device := private.yd_lock_admin_device(target_device);
  if device.configuration_status <> 'configured' then
    raise exception 'CONFIGURED_DEVICE_REQUIRED';
  end if;
  if rule_kind = 'site' and allowed and not private.yd_web_enabled(device.id) then
    raise exception 'WEB_SECTION_DISABLED';
  end if;
  delete from private.yd_scoped_request_grants g
    where g.device_id = device.id and g.request_kind = rule_kind and
      g.target = case when rule_kind = 'site' then private.yd_dns_host(rule_target) else trim(rule_target) end;
  removed := found;
  perform private.yd_save_device_rule(device.id, rule_kind, rule_target, allowed);
  if removed then
    update private.yd_device_policy p set revision = p.revision + 1, apply_failed = false
      where p.device_id = device.id;
  end if;
  return private.yd_policy_json_v2(device.id);
end;
$$;

create or replace function public.yd_set_temporary_site_rule(
  target_device uuid, rule_target text, expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  device public.devices := private.yd_lock_admin_device(target_device);
begin
  if device.configuration_status <> 'configured' then
    raise exception 'CONFIGURED_DEVICE_REQUIRED';
  end if;
  if not private.yd_web_enabled(device.id) then
    raise exception 'WEB_SECTION_DISABLED';
  end if;
  perform private.yd_save_temporary_site_rule(device.id, private.yd_dns_host(rule_target), expires_at, null);
  return private.yd_policy_json_v2(device.id);
end;
$$;

create or replace function public.yd_review_device_request(
  request_kind text, request_id uuid, decision text, note text,
  target_devices uuid[] default null, all_devices boolean default false
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  origin public.devices;
  destination public.devices;
  origin_id uuid;
  destination_id uuid;
  target text;
  expiry timestamptz;
  can_extend boolean := true;
  affected integer := 1;
  app_request private.yd_app_access_requests;
  site_request public.yd_site_requests;
  destinations uuid[] := coalesce(target_devices, '{}'::uuid[]);
begin
  perform private.yd_require_live_admin();
  if request_kind is null or request_kind not in ('app', 'site')
    or decision is null or decision not in ('approved', 'rejected', 'revoked')
    or length(coalesce(note, '')) > 2000 or all_devices is null
    or array_position(destinations, null) is not null
    or (all_devices and cardinality(destinations) > 0)
    or (decision <> 'approved' and (all_devices or cardinality(destinations) > 0)) then
    raise exception 'INVALID_REQUEST_SCOPE';
  end if;
  perform pg_advisory_xact_lock(673219843);
  if request_kind = 'app' then
    select r.* into app_request from private.yd_app_access_requests r where r.id = request_id;
    origin_id := app_request.device_id;
    target := app_request.package_name;
  else
    select r.* into site_request from public.yd_site_requests r where r.id = request_id;
    origin_id := site_request.device_id;
    target := private.yd_https_host(site_request.site_url);
    can_extend := site_request.requested_allowed;
  end if;
  if origin_id is null then raise exception 'DEVICE_NOT_AVAILABLE'; end if;
  origin := private.yd_lock_admin_device(origin_id, request_kind = 'app');

  if all_devices or cardinality(destinations) > 0 then
    if not can_extend or origin.platform <> 'Android' or origin.configuration_status <> 'configured' or target is null then
      raise exception 'INVALID_REQUEST_SCOPE';
    end if;
    if all_devices then
      select array(select d.id from public.devices d
        left join private.yd_device_policy p on p.device_id = d.id
        where d.user_id = origin.user_id and d.platform = 'Android'
          and d.configuration_status = 'configured'
          and (request_kind = 'app' or private.yd_web_enabled(d.id)))
      into destinations;
    end if;
    if request_kind = 'site' and not exists (
      select 1 from public.yd_device_links l join public.yd_app_accounts a on a.id = l.account_id
      where l.device_id = origin_id and a.is_active
        and (site_request.requested_account_id is null or site_request.requested_account_id = l.account_id)
    ) then
      raise exception 'SITE_REQUEST_NOT_AVAILABLE';
    end if;
  end if;

  -- Keep each decision atomic. Even an owner can only extend the decision
  -- to phones in the requesting device's workspace.
  for destination_id in select distinct u.id from unnest(destinations) as u(id)
    where u.id <> origin_id order by u.id loop
    destination := private.yd_lock_admin_device(destination_id);
    if destination.user_id <> origin.user_id or destination.configuration_status <> 'configured' then
      raise exception 'INVALID_REQUEST_SCOPE';
    end if;
    if request_kind = 'site' and not private.yd_web_enabled(destination.id) then
      raise exception 'WEB_SECTION_DISABLED';
    end if;
  end loop;

  if decision = 'revoked' then
    select 1 + count(*) into affected from private.yd_scoped_request_grants g
      where g.request_kind = yd_review_device_request.request_kind
        and g.request_id = yd_review_device_request.request_id;
  end if;
  if request_kind = 'app' then
    perform public.yd_review_app_access(request_id, decision, note);
  else
    perform public.yd_review_site(request_id, decision, note);
    if decision = 'approved' and (site_request.requested_hours is not null or site_request.requested_until is not null) then
      select r.allowed_until into expiry from public.yd_site_requests r where r.id = request_id;
      if expiry is null or expiry <= now() then raise exception 'SITE_WINDOW_EXPIRED'; end if;
    end if;
  end if;

  for destination_id in select distinct u.id from unnest(destinations) as u(id)
    where u.id <> origin_id order by u.id loop
    insert into private.yd_device_policy(device_id) values (destination_id) on conflict do nothing;
    insert into private.yd_scoped_request_grants(request_kind, request_id, device_id, target, expires_at)
      values (request_kind, request_id, destination_id, target, expiry);
    -- The original temporary-rule table has its own 200-host limit. Keeping
    -- the combined result bounded here leaves room for manual rules.
    if expiry is not null and (select count(*) from private.yd_active_temporary_site_rules(destination_id)) > 200 then
      raise exception 'SCOPED_RULE_LIMIT';
    end if;
    -- An omitted app rule cannot re-hide a package after a grant is removed.
    -- Keep an explicit deny to fall back to when there was no device rule.
    update private.yd_device_policy p set revision = p.revision + 1, apply_failed = false,
      apps = case when request_kind = 'app' and not (p.apps ? target)
        then jsonb_set(p.apps, array[target], 'false'::jsonb) else p.apps end,
      sites = p.sites where p.device_id = destination_id;
    affected := affected + 1;
  end loop;
  return affected;
end;
$$;

create or replace function public.set_yidream_device_sections(
  target_device_id uuid, web_enabled boolean, app_store_enabled boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  device public.devices;
  allow_web boolean := web_enabled;
  allow_store boolean := app_store_enabled;
begin
  if allow_web is null or allow_store is null then raise exception 'INVALID_DEVICE_CONTROLS'; end if;
  perform pg_advisory_xact_lock(673219843);
  device := private.yd_lock_admin_device(target_device_id);
  if device.configuration_status <> 'configured' then raise exception 'CONFIGURED_DEVICE_REQUIRED'; end if;
  insert into private.yd_device_policy(device_id) values (device.id) on conflict do nothing;
  update private.yd_device_policy p set
    web_enabled = allow_web,
    app_store_enabled = allow_store,
    site_requests_enabled = case when allow_web then p.site_requests_enabled else false end,
    revision = p.revision + 1, apply_failed = false
  where p.device_id = device.id and (
    coalesce(p.web_enabled, p.device_profile is distinct from 'mp3') is distinct from allow_web
    or coalesce(p.app_store_enabled, p.device_profile is distinct from 'mp3') is distinct from allow_store
    or (not allow_web and p.site_requests_enabled)
  );
  return private.yd_policy_json_v2(device.id);
end;
$$;

revoke all on function private.yd_web_enabled(uuid) from public, anon, authenticated;
revoke all on function public.set_yidream_device_sections(uuid,boolean,boolean) from public, anon, authenticated;
grant execute on function public.set_yidream_device_sections(uuid,boolean,boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
