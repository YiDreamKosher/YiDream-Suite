-- Per-device settings and code-only activation after approved USB preparation.
begin;

create table if not exists private.yd_usb_registrations (
  device_id uuid primary key references public.devices(id) on delete cascade,
  serial_hash text not null unique,
  model text not null
);

create table if not exists private.yd_pending_app_activation (
  device_id uuid primary key references public.devices(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  issued_by uuid not null references auth.users(id) on delete cascade,
  email text not null,
  contact_phone text not null,
  previous_token_hash text
);

alter table public.yd_device_links
  add column if not exists app_session_renewal_hash text;

create table if not exists private.yd_device_policy (
  device_id uuid primary key references public.devices(id) on delete cascade,
  revision bigint not null default 0,
  apps jsonb not null default '{}'::jsonb,
  sites jsonb not null default '{}'::jsonb,
  applied_revision bigint not null default 0,
  last_sync_at timestamptz,
  apply_failed boolean not null default false,
  check (revision >= applied_revision and applied_revision >= 0),
  check (jsonb_typeof(apps) = 'object' and jsonb_typeof(sites) = 'object')
);

alter table private.yd_usb_registrations enable row level security;
alter table private.yd_pending_app_activation enable row level security;
alter table private.yd_device_policy enable row level security;
revoke all on private.yd_usb_registrations, private.yd_pending_app_activation, private.yd_device_policy
  from public, anon, authenticated;

-- Fresh session and active role are checked on each administrator operation.
create or replace function private.yd_require_live_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or not private.yd_valid_device_issuer(actor) or not exists (
    select 1 from auth.sessions s
    where s.user_id = actor and s.id::text = auth.jwt()->>'session_id'
      and (s.not_after is null or s.not_after > now())
  ) then
    raise exception 'APP_ACCESS_DENIED';
  end if;
  return actor;
end;
$$;

create or replace function private.yd_lock_admin_device(target_device uuid, android_only boolean default true) returns public.devices
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.yd_require_live_admin();
  device public.devices;
begin
  select d.* into device from public.devices d
    where d.id = target_device and (not android_only or d.platform = 'Android')
      and (d.user_id = actor or public.is_platform_owner())
    for no key update;
  if not found then
    raise exception 'DEVICE_NOT_AVAILABLE';
  end if;
  return device;
end;
$$;

create or replace function public.yd_verify_usb_target(target_device uuid, usb_serial text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := private.yd_require_live_admin();
  serial text := trim(usb_serial);
  fingerprint text;
  registered_id uuid;
begin
  if serial is null or length(serial) not between 1 and 128 or serial ~ '[[:cntrl:]]' then
    return false;
  end if;
  if target_device is not null and not exists (
    select 1 from public.devices d where d.id = target_device and d.platform = 'Android'
      and (d.user_id = actor or public.is_platform_owner())
  ) then
    return false;
  end if;

  fingerprint := public.yd_token_hash(serial);
  select r.device_id into registered_id from private.yd_usb_registrations r where r.serial_hash = fingerprint;
  if registered_id is not null then
    return (target_device is null or target_device = registered_id) and exists (
      select 1 from public.devices d where d.id = registered_id and d.platform = 'Android'
        and (d.user_id = actor or public.is_platform_owner())
    );
  end if;
  return target_device is null or not exists (
    select 1 from private.yd_usb_registrations r where r.device_id = target_device
  );
end;
$$;

create or replace function public.yd_register_usb_device(
  usb_serial text, device_name text, device_model text, target_device uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.yd_require_live_admin();
  serial text := trim(usb_serial);
  label text := trim(device_name);
  normalized_model text := trim(device_model);
  fingerprint text;
  existing uuid;
  device public.devices;
begin
  if serial is null or length(serial) not between 1 and 128 or serial ~ '[[:cntrl:]]'
    or label is null or length(label) not between 1 and 100 or label ~ '[[:cntrl:]]'
    or normalized_model is null or length(normalized_model) not between 1 and 120 or normalized_model ~ '[[:cntrl:]]'
  then
    raise exception 'INVALID_USB_DEVICE';
  end if;

  fingerprint := public.yd_token_hash(serial);
  -- USB identifiers deduplicate records but do not authenticate a phone.
  perform pg_advisory_xact_lock(hashtextextended(fingerprint, 386801));
  select r.device_id into existing from private.yd_usb_registrations r where r.serial_hash = fingerprint;

  if existing is not null then
    device := private.yd_lock_admin_device(existing);
    if (target_device is not null and target_device <> device.id) or exists (
      select 1 from private.yd_usb_registrations r where r.device_id = existing and r.model <> normalized_model
    ) then
      raise exception 'USB_DEVICE_MISMATCH';
    end if;
  else
    if target_device is not null then
      device := private.yd_lock_admin_device(target_device);
      if exists (select 1 from private.yd_usb_registrations r where r.device_id = device.id) then
        raise exception 'USB_DEVICE_MISMATCH';
      end if;
    else
      insert into public.devices(user_id, name, platform, configuration_status)
      values (actor, label, 'Android', 'needs_configuration') returning * into device;
    end if;
    insert into private.yd_usb_registrations(device_id, serial_hash, model) values (device.id, fingerprint, normalized_model);
  end if;
  return jsonb_build_object('device_id', device.id, 'configuration_status', device.configuration_status);
end;
$$;

create or replace function public.yd_assign_device_client(target_device uuid, target_client uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  device public.devices := private.yd_lock_admin_device(target_device, false);
begin
  if target_client is not null then
    perform 1 from public.clients where id = target_client and user_id = device.user_id for share;
    if not found then
      raise exception 'CLIENT_NOT_AVAILABLE';
    end if;
  end if;
  update public.devices set client_id = target_client where id = device.id;
  return jsonb_build_object('device_id', device.id, 'client_id', target_client,
    'configuration_status', device.configuration_status);
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
    previous_token_hash = excluded.previous_token_hash;

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

  if previous_account.id is not null and previous_account.auth_user_id is null
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
  update private.yd_device_policy set applied_revision = 0, last_sync_at = null, apply_failed = false
    where device_id = device.id;

  return jsonb_build_object('account', private.yd_account_json(account), 'device_id', device.id,
    'token', token, 'app_token', session_token, 'expires_at', expiry);
end;
$$;

-- Suspending an existing account also revokes any code issued for its device.
create or replace function private.yd_clear_suspended_activation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.yd_pending_app_activation c using public.yd_device_links l
    where c.device_id = l.device_id and l.account_id = new.id;
  return new;
end;
$$;
drop trigger if exists yd_clear_suspended_activation on public.yd_app_accounts;
create trigger yd_clear_suspended_activation after update of is_active on public.yd_app_accounts
  for each row when (old.is_active and not new.is_active) execute function private.yd_clear_suspended_activation();

create or replace function private.yd_email_bound_device(app_account_id uuid) returns uuid
language sql stable set search_path = '' as $$
  select l.device_id from public.yd_device_links l join public.devices d on d.id = l.device_id
  where l.account_id = app_account_id and d.configuration_status = 'configured'
    and private.yd_valid_device_issuer(l.access_issuer_id)
    and (d.user_id = l.access_issuer_id or exists (
      select 1 from public.platform_admins p where p.user_id = l.access_issuer_id and p.role = 'owner' and p.is_active
    ))
  order by d.created_at desc limit 1;
$$;

-- An already enrolled email account can still sign back in on an older APK.
-- Verifying an email address does not approve a new account or device.
create or replace function public.yd_complete_app_profile(contact_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  canonical_email text;
  account public.yd_app_accounts;
  device uuid;
begin
  if auth.uid() is null or contact_phone is null or contact_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'INVALID_CONTACT';
  end if;
  select lower(u.email) into canonical_email from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until <= now())
      and exists (
        select 1 from auth.sessions s where s.user_id = u.id and s.id::text = auth.jwt()->>'session_id'
          and (s.not_after is null or s.not_after > now())
      );
  if canonical_email is null then
    raise exception 'EMAIL_CONFIRMATION_REQUIRED';
  end if;
  select a.* into account from public.yd_app_accounts a
    where a.auth_user_id = auth.uid() and a.email_verified and a.is_active for update;
  device := private.yd_email_bound_device(account.id);
  if device is null then
    raise exception 'APP_ACCESS_DENIED';
  end if;
  update public.yd_app_accounts set
    email = canonical_email, contact_phone = yd_complete_app_profile.contact_phone, last_seen_at = now()
    where id = account.id returning * into account;
  return jsonb_build_object('account', private.yd_account_json(account), 'device_id', device, 'expires_at', null);
end;
$$;

create or replace function public.yd_app_access_status(app_token text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  account public.yd_app_accounts;
  device uuid;
  expiry timestamptz;
  renewable boolean;
  session_digest text;
begin
  if app_token is not null then
    if app_token !~ '^[0-9a-f]{64}$' then
      raise exception 'APP_ACCESS_DENIED';
    end if;
    session_digest := public.yd_token_hash(app_token);
    -- A legacy activation rotates the session hash and therefore cannot inherit renewal.
    select l.device_id, l.app_session_expires_at, l.app_session_renewal_hash = session_digest into device, expiry, renewable
      from public.yd_app_accounts a
      join public.yd_device_links l on l.account_id = a.id
      join public.devices d on d.id = l.device_id
      where a.auth_user_id is null and a.is_active and l.app_session_hash = session_digest and l.app_session_expires_at > now()
        and d.configuration_status = 'configured' and private.yd_valid_device_issuer(l.access_issuer_id)
        and (d.user_id = l.access_issuer_id or exists (
          select 1 from public.platform_admins p where p.user_id = l.access_issuer_id and p.role = 'owner' and p.is_active
        ));
    select a.* into account from public.yd_app_accounts a
      join public.yd_device_links l on l.account_id = a.id where l.device_id = device and l.app_session_hash = session_digest;
  else
    select a.* into account from public.yd_app_accounts a where a.id = private.yd_confirmed_app_account();
    device := private.yd_email_bound_device(account.id);
  end if;
  if account.id is null or device is null then
    raise exception 'APP_ACCESS_DENIED';
  end if;

  update public.yd_app_accounts set last_seen_at = now()
    where id = account.id and is_active and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
  if renewable and expiry < now() + interval '83 days' then
    update public.yd_device_links set app_session_expires_at = now() + interval '90 days'
      where device_id = device and app_session_hash = session_digest
        and app_session_renewal_hash = session_digest and app_session_expires_at > now()
      returning app_session_expires_at into expiry;
    if not found then
      raise exception 'APP_ACCESS_DENIED';
    end if;
  end if;
  return jsonb_build_object('account', private.yd_account_json(account), 'device_id', device, 'expires_at', expiry);
end;
$$;

create or replace function private.yd_dns_host(value text) returns text
language sql immutable strict set search_path = '' as $$
  select case when length(host) between 4 and 253
    and host ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    and substring(host from '[^.]+$') ~ '[a-z]'
    and host !~ '\.(localhost|local)$'
    then host end
  from (select lower(trim(value)) as host) normalized;
$$;

create or replace function private.yd_https_host(value text) returns text
language sql immutable strict set search_path = '' as $$
  select case when length(value) <= 2048 and value !~ '[[:space:][:cntrl:]\\]'
    then private.yd_dns_host(substring(value from '^https://([^/?#:]+)(?::443)?(?:[/?#]|$)')) end;
$$;

create or replace function private.yd_policy_json(target_device uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('revision', coalesce(p.revision, 0), 'apps', coalesce(p.apps, '{}'::jsonb),
    'sites', coalesce(p.sites, '{}'::jsonb), 'applied_revision', coalesce(p.applied_revision, 0),
    'last_sync_at', p.last_sync_at, 'apply_failed', coalesce(p.apply_failed, false))
  from (select target_device as id) d left join private.yd_device_policy p on p.device_id = d.id;
$$;

create or replace function private.yd_save_device_rule(target_device uuid, rule_kind text, rule_target text, allowed boolean)
returns void language plpgsql set search_path = '' as $$
declare
  target text := trim(rule_target);
  rules jsonb;
  maximum integer;
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

  if rules -> target = to_jsonb(allowed) then
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
  return private.yd_policy_json(target_device);
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
  return private.yd_policy_json(device.id);
end;
$$;

create or replace function public.yd_get_device_policy(device_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.yd_policy_json(public.yd_require_device(device_token));
$$;

create or replace function public.yd_report_device_policy(device_token text, policy_revision bigint, applied boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
  update private.yd_device_policy p set
    applied_revision = case when applied then policy_revision else p.applied_revision end,
    last_sync_at = now(),
    apply_failed = not applied
  where p.device_id = device and p.revision = policy_revision;
  return private.yd_policy_json(device);
end;
$$;

alter table public.yd_site_requests add column if not exists requested_allowed boolean not null default true;

create or replace function public.yd_request_site_change(
  device_token text, site_url text, request_reason text, client_request_id uuid, requested_allowed boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  device uuid := public.yd_require_device(device_token);
begin
  if client_request_id is null or requested_allowed is null or private.yd_https_host(site_url) is null
    or length(coalesce(request_reason, '')) > 2000 then
    raise exception 'INVALID_SITE_REQUEST';
  end if;
  -- Share quota and idempotency with the existing request endpoint.
  perform 1 from public.yd_device_links l where l.device_id = device and l.token_hash = public.yd_token_hash(device_token) for update;
  if not found then
    raise exception 'APP_ACCESS_DENIED';
  end if;
  perform public.yd_require_device(device_token);
  if exists (
    select 1 from public.yd_site_requests r
    where r.device_id = device and r.client_request_id = yd_request_site_change.client_request_id
  ) then
    return '{}'::jsonb;
  end if;
  if (select count(*) from public.yd_site_requests r where r.device_id = device and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'SITE_REQUEST_LIMIT';
  end if;
  insert into public.yd_site_requests(device_id, client_request_id, site_url, reason, requested_allowed)
    values (device, client_request_id, site_url, coalesce(request_reason, ''), requested_allowed);
  return '{}'::jsonb;
end;
$$;

create or replace function public.yd_review_site(request_id uuid, decision text, note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.yd_require_live_admin();
  request public.yd_site_requests;
  device public.devices;
  host text;
begin
  if decision is null or decision not in ('approved', 'rejected', 'revoked') then
    raise exception 'INVALID_SITE_DECISION';
  end if;
  select r.* into request from public.yd_site_requests r where r.id = request_id;
  if not found then
    raise exception 'SITE_REQUEST_NOT_AVAILABLE';
  end if;
  device := private.yd_lock_admin_device(request.device_id, false);

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

  if device.platform = 'Android' and decision in ('approved', 'revoked') then
    host := private.yd_https_host(request.site_url);
    if host is null then
      raise exception 'INVALID_SITE_REQUEST';
    end if;
    perform private.yd_save_device_rule(device.id, 'site', host, decision = 'approved' and request.requested_allowed);
  end if;
end;
$$;

-- Import the latest existing decision for each valid hostname once, preserving
-- explicit approvals while avoiding unsolicited changes on a migration rerun.
with reviewed as (
  select r.device_id, private.yd_https_host(r.site_url) as host, r.status = 'approved' and r.requested_allowed as allowed,
    coalesce(r.reviewed_at, r.created_at) as reviewed_at, r.id
  from public.yd_site_requests r join public.devices d on d.id = r.device_id
  where r.status in ('approved', 'revoked') and d.platform = 'Android'
    and not exists (select 1 from private.yd_device_policy p where p.device_id = r.device_id)
), latest as (
  select distinct on (device_id, host) device_id, host, allowed, reviewed_at
  from reviewed where host is not null
  order by device_id, host, reviewed_at desc, id desc
)
insert into private.yd_device_policy(device_id, revision, sites)
  select device_id, 1, jsonb_object_agg(host, allowed) from latest group by device_id
on conflict (device_id) do nothing;

revoke all on function private.yd_require_live_admin(), private.yd_lock_admin_device(uuid, boolean),
  private.yd_clear_suspended_activation(),
  private.yd_email_bound_device(uuid), private.yd_dns_host(text), private.yd_https_host(text), private.yd_policy_json(uuid),
  private.yd_save_device_rule(uuid, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.yd_verify_usb_target(uuid, text), public.yd_register_usb_device(text, text, text, uuid), public.yd_assign_device_client(uuid, uuid),
  public.yd_issue_app_activation(uuid, text, text), public.yd_redeem_app_activation(text),
  public.yd_admin_device_policy(uuid), public.yd_set_device_rule(uuid, text, text, boolean),
  public.yd_get_device_policy(text), public.yd_report_device_policy(text, bigint, boolean),
  public.yd_request_site_change(text, text, text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.yd_verify_usb_target(uuid, text), public.yd_register_usb_device(text, text, text, uuid),
  public.yd_assign_device_client(uuid, uuid), public.yd_issue_app_activation(uuid, text, text),
  public.yd_admin_device_policy(uuid), public.yd_set_device_rule(uuid, text, text, boolean)
  to authenticated;
grant execute on function public.yd_redeem_app_activation(text), public.yd_get_device_policy(text),
  public.yd_report_device_policy(text, bigint, boolean), public.yd_request_site_change(text, text, text, uuid, boolean)
  to anon, authenticated;

notify pgrst, 'reload schema';
commit;
