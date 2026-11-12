-- Allow administrators to prepare client accounts before choosing an Android device.
-- Keep timed web approvals separate from permanent rules for older clients.
begin;

create table private.yd_managed_app_accounts (
  account_id uuid primary key references public.yd_app_accounts(id) on delete cascade,
  shop_id uuid not null references auth.users(id) on delete cascade
);
create index yd_managed_app_accounts_shop_idx on private.yd_managed_app_accounts(shop_id);
alter table private.yd_managed_app_accounts enable row level security;
revoke all on private.yd_managed_app_accounts from public, anon, authenticated;

alter table private.yd_pending_app_activation
  add column assigned_account_id uuid references public.yd_app_accounts(id) on delete cascade;
create unique index yd_pending_app_activation_account_idx
  on private.yd_pending_app_activation(assigned_account_id) where assigned_account_id is not null;

create or replace function public.yd_admin_create_app_account(contact_email text, contact_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.yd_require_live_admin();
  email text := lower(trim(contact_email));
  phone text := trim(contact_phone);
  account public.yd_app_accounts;
begin
  if email is null or length(email) not between 3 and 254
    or email !~ '^[^[:space:][:cntrl:]@]+@[^[:space:][:cntrl:]@]+\.[^[:space:][:cntrl:]@]+$'
    or phone is null or phone !~ '^\+[1-9][0-9]{7,14}$'
  then
    raise exception 'INVALID_CONTACT';
  end if;

  insert into public.yd_app_accounts(email, contact_phone)
    values (email, phone) returning * into account;
  insert into private.yd_managed_app_accounts(account_id, shop_id) values (account.id, actor);
  return private.yd_account_json(account) || jsonb_build_object(
    'device_id', null, 'device_name', null, 'can_manage', true, 'can_assign', true,
    'created_at', account.created_at, 'last_seen_at', account.last_seen_at,
    'pending_device_id', null, 'pending_expires_at', null
  );
end;
$$;

create or replace function public.yd_admin_assign_app_account(account_id uuid, target_device uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.yd_require_live_admin();
  account public.yd_app_accounts;
  device public.devices;
  activation jsonb;
begin
  perform pg_advisory_xact_lock(673219843);
  select a.* into account from public.yd_app_accounts a
    join private.yd_managed_app_accounts m on m.account_id = a.id
    where a.id = yd_admin_assign_app_account.account_id and a.is_active and a.auth_user_id is null
      and (m.shop_id = actor or public.is_platform_owner())
    for update of a;
  if not found then
    raise exception 'APP_ACCOUNT_NOT_AVAILABLE';
  end if;

  device := private.yd_lock_admin_device(target_device);
  if exists (
    select 1 from public.yd_device_links l where l.account_id = account.id and l.device_id <> device.id
  ) then
    raise exception 'APP_ACCOUNT_ALREADY_LINKED';
  end if;

  delete from private.yd_pending_app_activation c where c.assigned_account_id = account.id;
  activation := public.yd_issue_app_activation(device.id, account.email, account.contact_phone);
  update private.yd_pending_app_activation c set assigned_account_id = account.id
    where c.device_id = device.id;
  return activation || jsonb_build_object('device_id', device.id, 'account_id', account.id);
end;
$$;

create or replace function public.yd_list_app_accounts_v2() returns table (
  id uuid, email text, contact_phone text, email_verified boolean, is_active boolean,
  device_id uuid, device_name text, created_at timestamptz, last_seen_at timestamptz, can_manage boolean,
  pending_device_id uuid, pending_expires_at timestamptz, can_assign boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := private.yd_require_live_admin();
  owner boolean := public.is_platform_owner();
begin
  return query
    with visible as (
      select l.account_id, d.id as device_id, d.name as device_name, owner or not exists (
        select 1 from public.yd_device_links other_link join public.devices other_device on other_device.id = other_link.device_id
          where other_link.account_id = l.account_id and other_device.user_id <> actor
      ) as can_manage
      from public.yd_device_links l join public.devices d on d.id = l.device_id
      where owner or d.user_id = actor
      union all
      select m.account_id, null::uuid, null::text, true
      from private.yd_managed_app_accounts m
      where (owner or m.shop_id = actor)
        and not exists (select 1 from public.yd_device_links l where l.account_id = m.account_id)
    )
    select a.id, a.email, a.contact_phone, a.email_verified, a.is_active,
      v.device_id, v.device_name, a.created_at, a.last_seen_at, v.can_manage, c.device_id, c.expires_at,
      a.is_active and a.auth_user_id is null and v.can_manage and exists (
        select 1 from private.yd_managed_app_accounts m where m.account_id = a.id and (owner or m.shop_id = actor)
      )
    from visible v join public.yd_app_accounts a on a.id = v.account_id
    left join private.yd_pending_app_activation c on c.assigned_account_id = a.id and c.expires_at > now()
      and private.yd_valid_device_issuer(c.issued_by)
      and (owner or exists (select 1 from public.devices d where d.id = c.device_id and d.user_id = actor))
    order by a.created_at desc, v.device_name, a.id;
end;
$$;

create or replace function public.yd_list_app_accounts() returns table (
  id uuid, email text, contact_phone text, email_verified boolean, is_active boolean,
  device_id uuid, device_name text, created_at timestamptz, last_seen_at timestamptz, can_manage boolean
)
language sql stable security definer set search_path = '' as $$
  select a.id, a.email, a.contact_phone, a.email_verified, a.is_active,
    a.device_id, a.device_name, a.created_at, a.last_seen_at, a.can_manage
  from public.yd_list_app_accounts_v2() a;
$$;

create or replace function public.yd_set_app_account_access(target_account uuid, enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.yd_require_live_admin();
begin
  perform pg_advisory_xact_lock(673219843);
  if enabled is null then
    raise exception 'APP_ACCESS_DENIED';
  end if;
  perform 1 from public.yd_app_accounts a where a.id = target_account for update;
  if not found then
    raise exception 'APP_ACCESS_DENIED';
  end if;
  if not public.is_platform_owner() and (
    exists (
      select 1 from public.yd_device_links l join public.devices d on d.id = l.device_id
      where l.account_id = target_account and d.user_id <> actor
    ) or not (
      exists (
        select 1 from public.yd_device_links l join public.devices d on d.id = l.device_id
        where l.account_id = target_account and d.user_id = actor
      ) or exists (
        select 1 from private.yd_managed_app_accounts m where m.account_id = target_account and m.shop_id = actor
      )
    )
  ) then
    raise exception 'APP_ACCESS_DENIED';
  end if;

  update public.yd_app_accounts set is_active = enabled where id = target_account;
  if not enabled then
    update public.yd_device_links set pairing_hash = null, pairing_expires_at = null, pairing_created_by = null
      where account_id = target_account;
  end if;
end;
$$;

create or replace function public.yd_issue_app_activation(
  target_device uuid, contact_email text, contact_phone text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.yd_require_live_admin();
  device public.devices;
  link public.yd_device_links;
  email text := lower(trim(contact_email));
  phone text := trim(contact_phone);
  code text;
  expiry timestamptz;
begin
  -- Same ordering as legacy pairing and account suspension.
  perform pg_advisory_xact_lock(673219843);
  device := private.yd_lock_admin_device(target_device);
  if device.configuration_status <> 'configured' then
    raise exception 'CONFIGURED_DEVICE_REQUIRED';
  end if;
  if email is null or length(email) not between 3 and 254
    or email !~ '^[^[:space:][:cntrl:]@]+@[^[:space:][:cntrl:]@]+\.[^[:space:][:cntrl:]@]+$'
    or phone is null or phone !~ '^\+[1-9][0-9]{7,14}$'
  then
    raise exception 'INVALID_CONTACT';
  end if;
  select l.* into link from public.yd_device_links l where l.device_id = device.id;
  if exists (
    select 1 from public.yd_app_accounts a where a.id = link.account_id and not a.is_active
  ) then
    raise exception 'APP_ACCESS_DENIED';
  end if;

  code := upper(encode(extensions.gen_random_bytes(16), 'hex'));
  expiry := now() + interval '15 minutes';
  -- Store contact details before redemption. Only the issuer sees the plaintext code.
  insert into private.yd_pending_app_activation(device_id, code_hash, expires_at, issued_by, email, contact_phone, previous_token_hash)
    values (device.id, public.yd_token_hash(code), expiry, actor, email, phone, link.token_hash)
  on conflict (device_id) do update set
    code_hash = excluded.code_hash, expires_at = excluded.expires_at,
    issued_by = excluded.issued_by, email = excluded.email, contact_phone = excluded.contact_phone,
    previous_token_hash = excluded.previous_token_hash, assigned_account_id = null;

  -- Never change a live credential while just issuing a code.
  update public.yd_device_links
    set pairing_hash = null, pairing_expires_at = null, pairing_created_by = null
    where device_id = device.id;

  return jsonb_build_object('code', code, 'expires_at', expiry);
end;
$$;

create or replace function public.yd_redeem_app_activation(account_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  claim private.yd_pending_app_activation;
  device public.devices;
  link public.yd_device_links;
  previous_account public.yd_app_accounts;
  account public.yd_app_accounts;
  token text;
  session_token text;
  session_digest text;
  expiry timestamptz;
begin
  if account_code is null or length(account_code) > 64 or upper(trim(account_code)) !~ '^[0-9A-F]{32}$' then
    raise exception 'INVALID_ACCOUNT_CODE';
  end if;

  perform pg_advisory_xact_lock(673219843);
  select c.* into claim from private.yd_pending_app_activation c
    where c.code_hash = public.yd_token_hash(upper(trim(account_code))) and c.expires_at > now();
  if not found then
    raise exception 'INVALID_ACCOUNT_CODE';
  end if;

  select d.* into device from public.devices d
    where d.id = claim.device_id and d.platform = 'Android' and d.configuration_status = 'configured'
    for no key update;
  if not found or not private.yd_valid_device_issuer(claim.issued_by) or (
    device.user_id <> claim.issued_by and not exists (
      select 1 from public.platform_admins p where p.user_id = claim.issued_by and p.role = 'owner' and p.is_active
    )
  ) then
    raise exception 'INVALID_ACCOUNT_CODE';
  end if;

  select l.* into link from public.yd_device_links l where l.device_id = device.id;
  if link.token_hash is distinct from claim.previous_token_hash then
    raise exception 'INVALID_ACCOUNT_CODE';
  end if;

  select a.* into previous_account from public.yd_app_accounts a where a.id = link.account_id for update;
  if previous_account.id is not null and not previous_account.is_active then
    raise exception 'INVALID_ACCOUNT_CODE';
  end if;
  -- Recheck after locking the account. A suspension may have cleared this
  -- claim while redemption was waiting for the account row.
  perform 1 from private.yd_pending_app_activation c
    where c.device_id = device.id and c.code_hash = claim.code_hash and c.expires_at > now()
    for update;
  if not found then
    raise exception 'INVALID_ACCOUNT_CODE';
  end if;

  if claim.assigned_account_id is not null then
    select a.* into account from public.yd_app_accounts a
      join private.yd_managed_app_accounts m on m.account_id = a.id
      where a.id = claim.assigned_account_id and a.is_active and a.auth_user_id is null
        and a.email = claim.email and a.contact_phone = claim.contact_phone
        and (m.shop_id = claim.issued_by or exists (
          select 1 from public.platform_admins p where p.user_id = claim.issued_by and p.role = 'owner' and p.is_active
        ))
      for update of a;
    if not found or exists (
      select 1 from public.yd_device_links l where l.account_id = account.id and l.device_id <> device.id
    ) then
      raise exception 'INVALID_ACCOUNT_CODE';
    end if;
    update public.yd_app_accounts set last_seen_at = now()
      where id = account.id returning * into account;
    update private.yd_managed_app_accounts set shop_id = device.user_id where account_id = account.id;
  elsif previous_account.id is not null and previous_account.auth_user_id is null
    and previous_account.email = claim.email and previous_account.contact_phone = claim.contact_phone
    and not exists (
      select 1 from public.yd_device_links l where l.account_id = previous_account.id and l.device_id <> device.id
    )
  then
    update public.yd_app_accounts set last_seen_at = now()
      where id = previous_account.id returning * into account;
  else
    insert into public.yd_app_accounts(email, contact_phone, last_seen_at)
      values (claim.email, claim.contact_phone, now()) returning * into account;
  end if;

  token := encode(extensions.gen_random_bytes(32), 'hex');
  session_token := encode(extensions.gen_random_bytes(32), 'hex');
  session_digest := public.yd_token_hash(session_token);
  expiry := now() + interval '90 days';
  insert into public.yd_device_links(device_id, token_hash, account_id, access_issuer_id,
    app_session_hash, app_session_expires_at, app_session_renewal_hash)
    values (device.id, public.yd_token_hash(token), account.id, claim.issued_by,
      session_digest, expiry, session_digest)
  on conflict (device_id) do update set
    token_hash = excluded.token_hash, account_id = excluded.account_id, access_issuer_id = excluded.access_issuer_id,
    pairing_hash = null, pairing_expires_at = null, pairing_created_by = null,
    app_session_hash = excluded.app_session_hash, app_session_expires_at = excluded.app_session_expires_at,
    app_session_renewal_hash = excluded.app_session_renewal_hash;

  delete from private.yd_pending_app_activation where device_id = device.id;
  if link.account_id is distinct from account.id then
    perform 1 from private.yd_device_policy p where p.device_id = device.id for update;
    delete from private.yd_temporary_site_rules r
      where r.device_id = device.id and r.source_request_id is not null;
    if found then
      update private.yd_device_policy p set revision = p.revision + 1 where p.device_id = device.id;
    end if;
  end if;
  update private.yd_device_policy set applied_revision = 0, last_sync_at = null, apply_failed = false
    where device_id = device.id;

  return jsonb_build_object('account', private.yd_account_json(account), 'device_id', device.id,
    'token', token, 'app_token', session_token, 'expires_at', expiry);
end;
$$;

create or replace function private.yd_clear_suspended_activation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.yd_pending_app_activation c where c.assigned_account_id = new.id;
  delete from private.yd_pending_app_activation c using public.yd_device_links l
    where c.device_id = l.device_id and l.account_id = new.id;
  return new;
end;
$$;

alter table public.yd_site_requests
  add column requested_hours integer,
  add column requested_until timestamptz,
  add column allowed_until timestamptz,
  add column requested_account_id uuid references public.yd_app_accounts(id) on delete set null,
  add constraint yd_site_request_window_check check (
    (requested_hours is null or requested_hours = 24)
    and num_nonnulls(requested_hours, requested_until) <= 1
    and (requested_allowed or num_nonnulls(requested_hours, requested_until, allowed_until) = 0)
  );
create index yd_site_requests_account_idx
  on public.yd_site_requests(requested_account_id) where requested_account_id is not null;

create table private.yd_temporary_site_rules (
  device_id uuid not null references public.devices(id) on delete cascade,
  host text not null,
  expires_at timestamptz not null,
  source_request_id uuid references public.yd_site_requests(id) on delete cascade,
  primary key (device_id, host)
);
create index yd_temporary_site_rules_request_idx
  on private.yd_temporary_site_rules(source_request_id) where source_request_id is not null;
alter table private.yd_temporary_site_rules enable row level security;
revoke all on private.yd_temporary_site_rules from public, anon, authenticated;

create or replace function private.yd_active_temporary_site_rules(target_device uuid)
returns setof private.yd_temporary_site_rules language sql stable set search_path = '' as $$
  select r.* from private.yd_temporary_site_rules r
  where r.device_id = target_device and r.expires_at > now()
    and (r.source_request_id is null or exists (
      select 1 from public.yd_site_requests s join public.yd_device_links l
        on l.device_id = s.device_id and l.account_id = s.requested_account_id
      where s.id = r.source_request_id
    ));
$$;

create or replace function private.yd_policy_json_v2(target_device uuid) returns jsonb
language sql stable set search_path = '' set timezone = 'UTC' as $$
  select private.yd_policy_json(target_device) || jsonb_build_object(
    'server_time', now(),
    'temporary_sites', coalesce((
      select jsonb_object_agg(r.host, r.expires_at)
      from private.yd_active_temporary_site_rules(target_device) r
    ), '{}'::jsonb)
  );
$$;

create or replace function private.yd_save_temporary_site_rule(
  target_device uuid, target_host text, expires_at timestamptz, source_request_id uuid
) returns void language plpgsql set search_path = '' as $$
begin
  if private.yd_dns_host(target_host) is distinct from target_host or target_host is null
    or expires_at is null or expires_at <= now() or expires_at > now() + interval '365 days'
  then
    raise exception 'INVALID_SITE_WINDOW';
  end if;

  insert into private.yd_device_policy(device_id) values (target_device) on conflict do nothing;
  perform 1 from private.yd_device_policy p where p.device_id = target_device for update;
  delete from private.yd_temporary_site_rules r
    where r.device_id = target_device and r.expires_at <= now();
  if not exists (
    select 1 from private.yd_temporary_site_rules r where r.device_id = target_device and r.host = target_host
  ) and (
    select count(*) from private.yd_temporary_site_rules r where r.device_id = target_device
  ) >= 200 then
    raise exception 'DEVICE_RULE_LIMIT';
  end if;
  insert into private.yd_temporary_site_rules as r(device_id, host, expires_at, source_request_id)
    values (target_device, target_host, expires_at, source_request_id)
    on conflict (device_id, host) do update
    set expires_at = excluded.expires_at, source_request_id = excluded.source_request_id
    where (r.expires_at, r.source_request_id) is distinct from (excluded.expires_at, excluded.source_request_id);
  if found then
    update private.yd_device_policy p set revision = p.revision + 1, apply_failed = false
      where p.device_id = target_device;
  end if;
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
  perform private.yd_save_temporary_site_rule(device.id, private.yd_dns_host(rule_target), expires_at, null);
  return private.yd_policy_json_v2(device.id);
end;
$$;

create or replace function public.yd_get_device_policy_v2(device_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.yd_policy_json_v2(public.yd_require_device(device_token));
$$;

create or replace function private.yd_save_device_rule(target_device uuid, rule_kind text, rule_target text, allowed boolean)
returns void language plpgsql set search_path = '' as $$
declare
  target text := trim(rule_target);
  rules jsonb;
  maximum integer;
  cleared_window boolean := false;
begin
  if allowed is null then
    raise exception 'INVALID_DEVICE_RULE';
  end if;
  if rule_kind = 'site' then
    target := private.yd_dns_host(target);
    maximum := 200;
  elsif rule_kind = 'app' then
    maximum := 100;
    if length(target) > 200 or target !~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$'
      or target in ('com.yidream.mdm', 'com.android.settings', 'com.android.systemui')
    then
      raise exception 'INVALID_DEVICE_RULE';
    end if;
  else
    raise exception 'INVALID_DEVICE_RULE';
  end if;
  if target is null then
    raise exception 'INVALID_DEVICE_RULE';
  end if;

  insert into private.yd_device_policy(device_id) values (target_device) on conflict do nothing;
  select case when rule_kind = 'app' then p.apps else p.sites end into rules
    from private.yd_device_policy p where p.device_id = target_device for update;

  if rule_kind = 'site' then
    delete from private.yd_temporary_site_rules r
      where r.device_id = target_device and r.host = target;
    cleared_window := found;
  end if;
  if rules -> target = to_jsonb(allowed) and not cleared_window then
    return;
  end if;
  if not (rules ? target) and (select count(*) from jsonb_object_keys(rules)) >= maximum then
    raise exception 'DEVICE_RULE_LIMIT';
  end if;
  rules := jsonb_set(rules, array[target], to_jsonb(allowed));
  update private.yd_device_policy set
    apps = case when rule_kind = 'app' then rules else apps end,
    sites = case when rule_kind = 'site' then rules else sites end,
    revision = revision + 1,
    apply_failed = false
  where device_id = target_device;
end;
$$;

create or replace function public.yd_admin_device_policy(target_device uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.yd_lock_admin_device(target_device);
  return private.yd_policy_json_v2(target_device);
end;
$$;

create or replace function public.yd_set_device_rule(target_device uuid, rule_kind text, rule_target text, allowed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  device public.devices := private.yd_lock_admin_device(target_device);
begin
  if device.configuration_status <> 'configured' then
    raise exception 'CONFIGURED_DEVICE_REQUIRED';
  end if;
  perform private.yd_save_device_rule(device.id, rule_kind, rule_target, allowed);
  return private.yd_policy_json_v2(device.id);
end;
$$;

create or replace function private.yd_record_device_policy(device_token text, policy_revision bigint, applied boolean, supports_windows boolean)
returns void language plpgsql set search_path = '' as $$
declare
  device uuid := public.yd_require_device(device_token);
begin
  if policy_revision is null or policy_revision < 0 or applied is null then
    raise exception 'INVALID_POLICY_REPORT';
  end if;

  perform 1 from public.yd_device_links l where l.device_id = device and l.token_hash = public.yd_token_hash(device_token) for update;
  if not found then
    raise exception 'APP_ACCESS_DENIED';
  end if;
  perform public.yd_require_device(device_token);
  insert into private.yd_device_policy(device_id) values (device) on conflict do nothing;
  -- Serialize with site-window changes before checking an older client's capabilities.
  perform 1 from private.yd_device_policy p where p.device_id = device for update;
  if not supports_windows and exists (
    select 1 from private.yd_active_temporary_site_rules(device)
  ) then
    return;
  end if;
  update private.yd_device_policy p set
    applied_revision = case when applied then policy_revision else p.applied_revision end,
    last_sync_at = now(),
    apply_failed = not applied
  where p.device_id = device and p.revision = policy_revision;
end;
$$;

create or replace function public.yd_report_device_policy(device_token text, policy_revision bigint, applied boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.yd_record_device_policy(device_token, policy_revision, applied, false);
  return private.yd_policy_json(public.yd_require_device(device_token));
end;
$$;

create or replace function public.yd_report_device_policy_v2(device_token text, policy_revision bigint, applied boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.yd_record_device_policy(device_token, policy_revision, applied, true);
  return private.yd_policy_json_v2(public.yd_require_device(device_token));
end;
$$;

create or replace function public.yd_request_site_window(
  device_token text, site_url text, request_reason text, client_request_id uuid,
  requested_hours integer default null, requested_until timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  device uuid := public.yd_require_device(device_token);
  app_account uuid;
begin
  if client_request_id is null or private.yd_https_host(site_url) is null
    or length(coalesce(request_reason, '')) > 2000
  then
    raise exception 'INVALID_SITE_REQUEST';
  end if;

  -- Match the permanent request endpoint's locking and quota.
  select l.account_id into app_account from public.yd_device_links l
    where l.device_id = device and l.token_hash = public.yd_token_hash(device_token) for update;
  if app_account is null then
    raise exception 'APP_ACCESS_DENIED';
  end if;
  perform public.yd_require_device(device_token);
  if exists (
    select 1 from public.yd_site_requests r
    where r.device_id = device and r.client_request_id = yd_request_site_window.client_request_id
  ) then
    return '{}'::jsonb;
  end if;
  if num_nonnulls(requested_hours, requested_until) <> 1
    or (requested_hours is not null and requested_hours <> 24)
    or (requested_until is not null and (requested_until <= now() or requested_until > now() + interval '365 days'))
  then
    raise exception 'INVALID_SITE_WINDOW';
  end if;
  if not exists (select 1 from public.devices d where d.id = device and d.platform = 'Android') then
    raise exception 'INVALID_SITE_REQUEST';
  end if;
  if (select count(*) from public.yd_site_requests r where r.device_id = device and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'SITE_REQUEST_LIMIT';
  end if;

  insert into public.yd_site_requests(device_id, client_request_id, site_url, reason, requested_allowed,
    requested_hours, requested_until, requested_account_id)
    values (device, client_request_id, site_url, coalesce(request_reason, ''), true,
      requested_hours, requested_until, app_account);
  return '{}'::jsonb;
end;
$$;

create or replace function public.yd_device_requests(device_token text)
returns setof public.yd_site_requests language plpgsql stable security definer set search_path = '' as $$
declare
  device uuid := public.yd_require_device(device_token);
begin
  return query
    select r.* from public.yd_site_requests r
    join public.yd_device_links l on l.device_id = r.device_id
    where r.device_id = device and l.token_hash = public.yd_token_hash(device_token)
      and ((r.requested_hours is null and r.requested_until is null) or r.requested_account_id = l.account_id)
    order by r.created_at desc limit 100;
end;
$$;

create or replace function public.yd_review_site(request_id uuid, decision text, note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.yd_require_live_admin();
  request public.yd_site_requests;
  device public.devices;
  normalized_host text;
  expiry timestamptz;
begin
  if decision is null or decision not in ('approved', 'rejected', 'revoked') then
    raise exception 'INVALID_SITE_DECISION';
  end if;
  select r.* into request from public.yd_site_requests r where r.id = request_id;
  if not found then
    raise exception 'SITE_REQUEST_NOT_AVAILABLE';
  end if;
  if request.requested_hours is not null or request.requested_until is not null then
    perform pg_advisory_xact_lock(673219843);
  end if;
  device := private.yd_lock_admin_device(request.device_id, false);
  if decision = 'approved' and (request.requested_hours is not null or request.requested_until is not null) then
    perform 1 from public.yd_device_links l join public.yd_app_accounts a on a.id = l.account_id
      where l.device_id = device.id and l.account_id = request.requested_account_id and a.is_active
      for share of l, a;
    if not found or device.configuration_status <> 'configured' then
      raise exception 'SITE_REQUEST_NOT_AVAILABLE';
    end if;
  end if;

  update public.yd_site_requests r set
    status = decision, admin_note = coalesce(note, ''), reviewed_at = now(), reviewed_by = actor
  where r.id = request.id and (
    (r.status = 'pending' and decision in ('approved', 'rejected')) or
    (r.status = 'approved' and decision = 'revoked') or
    (r.status = 'revoked' and decision = 'approved')
  ) returning * into request;
  if not found then
    raise exception 'SITE_REQUEST_NOT_AVAILABLE';
  end if;

  if device.platform <> 'Android' or decision = 'rejected' then
    return;
  end if;
  normalized_host := private.yd_https_host(request.site_url);
  if normalized_host is null then
    raise exception 'INVALID_SITE_REQUEST';
  end if;

  if request.requested_hours is null and request.requested_until is null then
    perform private.yd_save_device_rule(device.id, 'site', normalized_host, decision = 'approved' and request.requested_allowed);
  elsif decision = 'approved' then
    expiry := coalesce(request.requested_until, now() + make_interval(hours => request.requested_hours));
    if expiry <= now() then
      raise exception 'SITE_WINDOW_EXPIRED';
    end if;
    perform private.yd_save_temporary_site_rule(device.id, normalized_host, expiry, request.id);
    update public.yd_site_requests r set allowed_until = expiry where r.id = request.id;
  else
    perform 1 from private.yd_device_policy p where p.device_id = device.id for update;
    delete from private.yd_temporary_site_rules r
      where r.device_id = device.id and r.host = normalized_host and r.source_request_id = request.id;
    if found then
      update private.yd_device_policy p set revision = p.revision + 1, apply_failed = false
        where p.device_id = device.id;
    end if;
  end if;
end;
$$;

revoke all on function private.yd_policy_json_v2(uuid), private.yd_active_temporary_site_rules(uuid),
  private.yd_save_temporary_site_rule(uuid, text, timestamptz, uuid),
  private.yd_record_device_policy(text, bigint, boolean, boolean)
  from public, anon, authenticated;

revoke all on function public.yd_admin_create_app_account(text, text), public.yd_admin_assign_app_account(uuid, uuid),
  public.yd_list_app_accounts_v2(), public.yd_set_temporary_site_rule(uuid, text, timestamptz),
  public.yd_get_device_policy_v2(text), public.yd_report_device_policy_v2(text, bigint, boolean),
  public.yd_request_site_window(text, text, text, uuid, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.yd_admin_create_app_account(text, text), public.yd_admin_assign_app_account(uuid, uuid),
  public.yd_list_app_accounts_v2(), public.yd_set_temporary_site_rule(uuid, text, timestamptz) to authenticated;
grant execute on function public.yd_get_device_policy_v2(text), public.yd_report_device_policy_v2(text, bigint, boolean),
  public.yd_request_site_window(text, text, text, uuid, integer, timestamptz) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
