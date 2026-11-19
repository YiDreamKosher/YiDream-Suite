begin;

alter table private.yd_device_policy
  add column if not exists device_profile text check (device_profile in ('mp3', 'qin')),
  add column if not exists app_requests_enabled boolean not null default false,
  add column if not exists site_requests_enabled boolean not null default false;

create table if not exists private.yd_scoped_request_grants (
  request_kind text not null check (request_kind in ('app', 'site')),
  request_id uuid not null,
  device_id uuid not null references public.devices(id) on delete cascade,
  target text not null,
  primary key (request_kind, request_id, device_id)
);
alter table private.yd_scoped_request_grants
  add column if not exists expires_at timestamptz check (expires_at is null or request_kind = 'site');
create index if not exists yd_scoped_request_grants_device
  on private.yd_scoped_request_grants(device_id, request_kind, target);
alter table private.yd_scoped_request_grants enable row level security;
revoke all on private.yd_scoped_request_grants from public, anon, authenticated;

create or replace function private.yd_scoped_rules(target_device uuid, kind text) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(g.target, true), '{}'::jsonb)
  from (select distinct target from private.yd_scoped_request_grants
    where device_id = target_device and request_kind = kind and expires_at is null) g;
$$;

create or replace function private.yd_policy_json(target_device uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'revision', coalesce(p.revision, 0),
    'apps', coalesce(p.apps, '{}'::jsonb) || private.yd_scoped_rules(target_device, 'app'),
    'sites', case when p.device_profile = 'mp3' then '{}'::jsonb
      else coalesce(p.sites, '{}'::jsonb) || private.yd_scoped_rules(target_device, 'site') end,
    'applied_revision', coalesce(p.applied_revision, 0),
    'last_sync_at', p.last_sync_at,
    'apply_failed', coalesce(p.apply_failed, false),
    'device_profile', p.device_profile,
    'app_requests_enabled', coalesce(p.app_requests_enabled, false),
    'site_requests_enabled', p.device_profile is distinct from 'mp3'
      and coalesce(p.site_requests_enabled, false)
  )
  from (select target_device as id) d left join private.yd_device_policy p on p.device_id = d.id;
$$;

create or replace function private.yd_active_temporary_site_rules(target_device uuid)
returns setof private.yd_temporary_site_rules language sql stable set search_path = '' as $$
  with eligible as (
    select target_device as id where not exists (
      select 1 from private.yd_device_policy p
      where p.device_id = target_device and p.device_profile = 'mp3'
    )
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
begin
  insert into private.yd_device_policy(device_id) values (target_device) on conflict do nothing;
  update private.yd_device_policy p set
    device_profile = case when set_profile then profile else p.device_profile end,
    app_requests_enabled = coalesce(allow_apps, p.app_requests_enabled),
    site_requests_enabled = case when (case when set_profile then profile else p.device_profile end) = 'mp3'
      then false else coalesce(allow_sites, p.site_requests_enabled) end,
    revision = p.revision + 1, apply_failed = false
  where p.device_id = target_device and (
    (set_profile and p.device_profile is distinct from profile)
    or (allow_apps is not null and p.app_requests_enabled is distinct from allow_apps)
    or (p.site_requests_enabled is distinct from case
      when (case when set_profile then profile else p.device_profile end) = 'mp3' then false
      else coalesce(allow_sites, p.site_requests_enabled) end)
  );
end;
$$;

create or replace function public.yd_admin_set_device_controls(
  target_device uuid, profile text, app_requests_enabled boolean, site_requests_enabled boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  device public.devices;
begin
  if (profile is not null and profile not in ('mp3', 'qin'))
    or app_requests_enabled is null or site_requests_enabled is null then
    raise exception 'INVALID_DEVICE_CONTROLS';
  end if;
  perform pg_advisory_xact_lock(673219843);
  device := private.yd_lock_admin_device(target_device);
  perform private.yd_write_device_controls(device.id, profile, true, app_requests_enabled, site_requests_enabled);
  return private.yd_policy_json_v2(device.id);
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
    if site_requests_enabled is true and exists (
      select 1 from private.yd_device_policy p where p.device_id = target and p.device_profile = 'mp3'
    ) then
      raise exception 'MP3_WEB_DISABLED';
    end if;
    perform private.yd_write_device_controls(target, null, false, app_requests_enabled, site_requests_enabled);
    affected := affected + 1;
  end loop;
  return affected;
end;
$$;

-- Existing request RPCs still check the device credential and quotas. The
-- insert gate applies to every generation of those RPCs.
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
    if not policy.site_requests_enabled or policy.device_profile = 'mp3' then
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

create or replace trigger yd_enforce_app_request_permission
  before insert on private.yd_app_access_requests for each row
  execute function private.yd_enforce_request_permission();
create or replace trigger yd_enforce_site_request_permission
  before insert on public.yd_site_requests for each row
  execute function private.yd_enforce_request_permission();

create or replace function public.yd_request_site(
  device_token text, site_url text, request_reason text, client_request_id uuid
) returns jsonb language sql security definer set search_path = '' as $$
  select public.yd_request_site_change(device_token, site_url, request_reason, client_request_id, true);
$$;

create or replace function public.yd_device_requests(device_token text)
returns setof public.yd_site_requests language plpgsql stable security definer set search_path = '' as $$
declare
  device uuid := public.yd_require_device(device_token);
begin
  return query select r.* from public.yd_site_requests r
  join public.yd_device_links l on l.device_id = r.device_id
  where r.device_id = device and l.token_hash = public.yd_token_hash(device_token)
    and (r.requested_account_id = l.account_id or
      (r.requested_account_id is null and r.requested_hours is null and r.requested_until is null))
  order by r.created_at desc limit 100;
end;
$$;

create or replace function private.yd_guard_site_approval() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'approved' and old.status is distinct from new.status then
    if exists (select 1 from private.yd_device_policy p
        where p.device_id = new.device_id and p.device_profile = 'mp3') then
      raise exception 'MP3_WEB_DISABLED';
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

create or replace trigger yd_guard_site_approval
  before update of status on public.yd_site_requests for each row
  execute function private.yd_guard_site_approval();

-- Scope grants supplement device rules. Removing one approval leaves an
-- independent approval or a pre-existing device rule intact.
create or replace function private.yd_remove_request_grants() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  kind text := case when tg_table_name = 'yd_site_requests' then 'site' else 'app' end;
begin
  if tg_op = 'UPDATE' then
    if old.status <> 'approved' or new.status = 'approved' then return new; end if;
  end if;
  with removed as (
    delete from private.yd_scoped_request_grants g
    where g.request_kind = kind and g.request_id = old.id returning g.device_id
  )
  update private.yd_device_policy p set revision = p.revision + 1, apply_failed = false
    where p.device_id in (select device_id from removed);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace trigger yd_remove_app_request_grants
  after update of status or delete on private.yd_app_access_requests for each row
  execute function private.yd_remove_request_grants();
create or replace trigger yd_remove_site_request_grants
  after update of status or delete on public.yd_site_requests for each row
  execute function private.yd_remove_request_grants();

create or replace function private.yd_remove_reassigned_grants() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.account_id is not distinct from old.account_id then return new; end if;
  end if;
  with removed as (
    delete from private.yd_scoped_request_grants g
    where (g.request_kind = 'app' and exists (select 1 from private.yd_app_access_requests r
      where r.id = g.request_id and r.device_id = old.device_id and r.account_id = old.account_id))
      or (g.request_kind = 'site' and exists (select 1 from public.yd_site_requests r
        where r.id = g.request_id and r.device_id = old.device_id
          and (r.requested_account_id is null or r.requested_account_id = old.account_id)))
    returning g.device_id
  )
  update private.yd_device_policy p set revision = p.revision + 1, apply_failed = false
    where p.device_id in (select device_id from removed);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace trigger yd_remove_reassigned_grants
  after update of account_id or delete on public.yd_device_links for each row
  execute function private.yd_remove_reassigned_grants();

create or replace function private.yd_check_effective_rule_limits() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from jsonb_object_keys(new.apps || private.yd_scoped_rules(new.device_id, 'app'))) > 100
    or (select count(*) from jsonb_object_keys(new.sites || private.yd_scoped_rules(new.device_id, 'site'))) > 200 then
    raise exception 'SCOPED_RULE_LIMIT';
  end if;
  return new;
end;
$$;

create or replace trigger yd_check_effective_rule_limits
  before update of apps, sites on private.yd_device_policy for each row
  execute function private.yd_check_effective_rule_limits();

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
  if rule_kind = 'site' and allowed and exists (
    select 1 from private.yd_device_policy p where p.device_id = device.id and p.device_profile = 'mp3'
  ) then
    raise exception 'MP3_WEB_DISABLED';
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
  if exists (select 1 from private.yd_device_policy p
    where p.device_id = device.id and p.device_profile = 'mp3') then
    raise exception 'MP3_WEB_DISABLED';
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
          and (request_kind = 'app' or p.device_profile is distinct from 'mp3'))
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
    if request_kind = 'site' and exists (select 1 from private.yd_device_policy p
      where p.device_id = destination.id and p.device_profile = 'mp3') then
      raise exception 'MP3_WEB_DISABLED';
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

revoke all on function private.yd_scoped_rules(uuid,text),
  private.yd_write_device_controls(uuid,text,boolean,boolean,boolean),
  private.yd_enforce_request_permission(), private.yd_guard_site_approval(),
  private.yd_remove_request_grants(), private.yd_remove_reassigned_grants(),
  private.yd_check_effective_rule_limits()
  from public, anon, authenticated;
revoke all on function public.yd_admin_set_device_controls(uuid,text,boolean,boolean),
  public.yd_admin_set_request_permissions(uuid[],boolean,boolean),
  public.yd_review_device_request(text,uuid,text,text,uuid[],boolean) from public, anon, authenticated;
grant execute on function public.yd_admin_set_device_controls(uuid,text,boolean,boolean),
  public.yd_admin_set_request_permissions(uuid[],boolean,boolean),
  public.yd_review_device_request(text,uuid,text,text,uuid[],boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
