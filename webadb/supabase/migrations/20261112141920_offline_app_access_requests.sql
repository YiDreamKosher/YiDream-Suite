-- Access requests for already installed apps. Approval only updates a device policy.
begin;

create table if not exists private.yd_app_access_requests (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  account_id uuid not null references public.yd_app_accounts(id) on delete cascade,
  client_request_id uuid not null,
  package_name text not null,
  reason text not null default '' check (length(reason) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'revoked')),
  admin_note text not null default '' check (length(admin_note) <= 2000),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  unique (device_id, account_id, client_request_id)
);
create index if not exists yd_app_access_requests_device_recent
  on private.yd_app_access_requests (device_id, created_at desc, id);
create index if not exists yd_app_access_requests_account
  on private.yd_app_access_requests (account_id);
alter table private.yd_app_access_requests enable row level security;
revoke all on private.yd_app_access_requests from public, anon, authenticated;

create or replace function private.yd_requestable_package(candidate text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    length(candidate) between 3 and 200
    and candidate ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$'
    and lower(candidate) !~ '^com\.android\.(providers|shell|settings|systemui|permissioncontroller|packageinstaller)(\.|$)'
    and lower(candidate) not in (
      'com.yidream.mdm', 'com.google.android.permissioncontroller', 'com.google.android.packageinstaller',
      'com.android.vending', 'com.amazon.venezia', 'com.sec.android.app.samsungapps',
      'com.huawei.appmarket', 'com.xiaomi.market', 'com.oppo.market', 'com.heytap.market',
      'com.bbk.appstore', 'com.vivo.appstore', 'org.fdroid.fdroid', 'com.aurora.store'
    ), false
  );
$$;

create or replace function public.yd_request_app_access(
  device_token text, package_name text, request_reason text, client_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  device uuid := public.yd_require_device(device_token);
  app_account uuid;
begin
  if client_request_id is null or not private.yd_requestable_package(package_name)
    or length(coalesce(request_reason, '')) > 2000
  then
    raise exception 'INVALID_APP_REQUEST';
  end if;

  select l.account_id into app_account
    from public.yd_device_links l
    where l.device_id = device and l.token_hash = public.yd_token_hash(device_token)
    for update;
  if app_account is null then
    raise exception 'APP_ACCESS_DENIED';
  end if;
  perform public.yd_require_device(device_token);

  if exists (
    select 1 from private.yd_app_access_requests r
    where r.device_id = device and r.account_id = app_account
      and r.client_request_id = yd_request_app_access.client_request_id
  ) then
    return '{}'::jsonb;
  end if;

  if (
    select count(*) from private.yd_app_access_requests r
    where r.device_id = device and r.created_at > now() - interval '1 day'
  ) >= 20 then
    raise exception 'APP_REQUEST_LIMIT';
  end if;

  insert into private.yd_app_access_requests (device_id, account_id, client_request_id, package_name, reason)
    values (device, app_account, client_request_id, package_name, coalesce(request_reason, ''));
  return '{}'::jsonb;
end;
$$;

create or replace function public.yd_device_app_requests(device_token text)
returns table (
  id uuid, device_id uuid, client_request_id uuid, package_name text, reason text,
  status text, admin_note text, created_at timestamptz, reviewed_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  device uuid := public.yd_require_device(device_token);
begin
  return query
    select r.id, r.device_id, r.client_request_id, r.package_name, r.reason,
      r.status, r.admin_note, r.created_at, r.reviewed_at
    from private.yd_app_access_requests r
    join public.yd_device_links l on l.device_id = r.device_id and l.account_id = r.account_id
    where r.device_id = device
    order by r.created_at desc, r.id desc limit 200;
end;
$$;

create or replace function public.yd_admin_app_requests()
returns table (
  id uuid, device_id uuid, client_request_id uuid, package_name text, reason text,
  status text, admin_note text, created_at timestamptz, reviewed_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := private.yd_require_live_admin();
begin
  return query
    select r.id, r.device_id, r.client_request_id, r.package_name, r.reason,
      r.status, r.admin_note, r.created_at, r.reviewed_at
    from private.yd_app_access_requests r
    join public.devices d on d.id = r.device_id
    join public.yd_device_links l on l.device_id = r.device_id and l.account_id = r.account_id
    join public.yd_app_accounts a on a.id = l.account_id
    where (d.user_id = actor or public.is_platform_owner())
      and d.platform = 'Android' and d.configuration_status = 'configured' and a.is_active
    order by r.created_at desc, r.id desc limit 200;
end;
$$;

create or replace function public.yd_review_app_access(request_id uuid, decision text, note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.yd_require_live_admin();
  request private.yd_app_access_requests;
  device public.devices;
begin
  if decision is null or decision not in ('approved', 'rejected', 'revoked')
    or length(coalesce(note, '')) > 2000
  then
    raise exception 'INVALID_APP_DECISION';
  end if;

  select r.* into request from private.yd_app_access_requests r
    where r.id = request_id and exists (
      select 1 from public.devices d
      where d.id = r.device_id and (d.user_id = actor or public.is_platform_owner())
    );
  if not found then
    raise exception 'APP_REQUEST_NOT_AVAILABLE';
  end if;

  -- Keep the same lock order as activation and account suspension.
  perform pg_advisory_xact_lock(673219843);
  device := private.yd_lock_admin_device(request.device_id);
  if device.configuration_status <> 'configured' then
    raise exception 'APP_REQUEST_NOT_AVAILABLE';
  end if;
  perform 1 from public.yd_device_links l
    join public.yd_app_accounts a on a.id = l.account_id
    where l.device_id = device.id and l.account_id = request.account_id and a.is_active
    for share of l, a;
  if not found then
    raise exception 'APP_REQUEST_NOT_AVAILABLE';
  end if;

  update private.yd_app_access_requests r set
    status = decision, admin_note = coalesce(note, ''), reviewed_at = now(), reviewed_by = actor
  where r.id = request.id and (
    (r.status = 'pending' and decision in ('approved', 'rejected')) or
    (r.status = 'approved' and decision = 'revoked') or
    (r.status = 'revoked' and decision = 'approved')
  ) returning * into request;
  if not found then
    raise exception 'APP_REQUEST_NOT_AVAILABLE';
  end if;

  if decision in ('approved', 'revoked') then
    if not private.yd_requestable_package(request.package_name) then
      raise exception 'INVALID_APP_REQUEST';
    end if;
    perform private.yd_save_device_rule(device.id, 'app', request.package_name, decision = 'approved');
  end if;
end;
$$;

revoke all on function private.yd_requestable_package(text) from public, anon, authenticated;
revoke all on function public.yd_request_app_access(text, text, text, uuid),
  public.yd_device_app_requests(text), public.yd_admin_app_requests(),
  public.yd_review_app_access(uuid, text, text) from public, anon, authenticated;
grant execute on function public.yd_request_app_access(text, text, text, uuid),
  public.yd_device_app_requests(text) to anon, authenticated;
grant execute on function public.yd_admin_app_requests(),
  public.yd_review_app_access(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
