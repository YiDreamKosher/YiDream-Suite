begin;

alter table private.yd_pending_app_activation add column if not exists activation_id uuid;
alter table private.yd_device_policy
  add column if not exists redeemed_activation_id uuid,
  add column if not exists redeemed_activation_token_hash text;

create or replace function private.yd_number_activation() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.activation_id := gen_random_uuid();
  return new;
end;
$$;

create or replace trigger yd_number_activation
  before insert or update of code_hash on private.yd_pending_app_activation
  for each row execute function private.yd_number_activation();

create or replace function private.yd_can_recover_device_account(
  target_device uuid, account public.yd_app_accounts
) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((account).is_active and (account).auth_user_id is null
    and length((account).email) between 3 and 254
    and (account).email = lower(trim((account).email))
    and (account).email ~ '^[^[:space:][:cntrl:]@]+@[^[:space:][:cntrl:]@]+\.[^[:space:][:cntrl:]@]+$'
    and (account).contact_phone ~ '^\+[1-9][0-9]{7,14}$'
    and not exists (
      select 1 from public.yd_device_links l
      where l.account_id = (account).id and l.device_id <> target_device
    ), false);
$$;

create or replace function public.yd_admin_device_enrollment(target_device uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := private.yd_require_live_admin();
  link public.yd_device_links;
  account public.yd_app_accounts;
  policy private.yd_device_policy;
  pending_id uuid;
begin
  if not exists (
    select 1 from public.devices d where d.id = target_device and d.platform = 'Android'
      and d.configuration_status = 'configured' and (d.user_id = actor or public.is_platform_owner())
  ) then
    raise exception 'DEVICE_NOT_AVAILABLE';
  end if;
  select l.* into link from public.yd_device_links l where l.device_id = target_device;
  select a.* into account from public.yd_app_accounts a where a.id = link.account_id;
  select p.* into policy from private.yd_device_policy p where p.device_id = target_device;
  select c.activation_id into pending_id from private.yd_pending_app_activation c
    where c.device_id = target_device and c.expires_at > now()
      and c.previous_token_hash is not distinct from link.token_hash
      and private.yd_valid_device_issuer(c.issued_by);
  return jsonb_build_object(
    'device_id', target_device,
    'state', case when account.id is null then 'unlinked'
      when not account.is_active then 'suspended' else 'linked' end,
    'needs_contact', account.id is null,
    'can_issue', account.id is null or private.yd_can_recover_device_account(target_device, account),
    'pending_activation_id', pending_id,
    'redeemed_activation_id', case when account.is_active
      and link.token_hash = policy.redeemed_activation_token_hash then policy.redeemed_activation_id end,
    'last_sync_at', case when account.is_active and private.yd_valid_device_issuer(link.access_issuer_id)
      then policy.last_sync_at end
  );
end;
$$;

create or replace function public.yd_admin_issue_device_activation(
  target_device uuid, contact_email text default null, contact_phone text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  device public.devices;
  account public.yd_app_accounts;
  activation jsonb;
  attempt uuid;
begin
  perform pg_advisory_xact_lock(673219843);
  device := private.yd_lock_admin_device(target_device);
  if device.configuration_status <> 'configured' then
    raise exception 'CONFIGURED_DEVICE_REQUIRED';
  end if;
  select a.* into account from public.yd_device_links l
    join public.yd_app_accounts a on a.id = l.account_id
    where l.device_id = device.id for update of a;
  if account.id is not null then
    if not private.yd_can_recover_device_account(device.id, account) then
      raise exception 'ACCOUNT_RECOVERY_UNAVAILABLE';
    end if;
    contact_email := account.email;
    contact_phone := account.contact_phone;
  end if;
  activation := public.yd_issue_app_activation(device.id, contact_email, contact_phone);
  select c.activation_id into strict attempt from private.yd_pending_app_activation c
    where c.device_id = device.id;
  return activation || jsonb_build_object('device_id', device.id, 'activation_id', attempt);
end;
$$;

-- Preserve the existing code validation and account rotation for deployed apps.
do $$
begin
  if to_regprocedure('private.yd_redeem_app_activation(text)') is null then
    alter function public.yd_redeem_app_activation(text) set schema private;
  end if;
end;
$$;

create or replace function public.yd_redeem_app_activation(account_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  attempt uuid;
  redemption jsonb;
begin
  if account_code is null or length(account_code) > 64 or upper(trim(account_code)) !~ '^[0-9A-F]{32}$' then
    raise exception 'INVALID_ACCOUNT_CODE';
  end if;
  perform pg_advisory_xact_lock(673219843);
  select c.activation_id into attempt from private.yd_pending_app_activation c
    where c.code_hash = public.yd_token_hash(upper(trim(account_code)));
  redemption := private.yd_redeem_app_activation(account_code);
  if attempt is not null then
    insert into private.yd_device_policy(device_id, redeemed_activation_id, redeemed_activation_token_hash)
      values ((redemption->>'device_id')::uuid, attempt, public.yd_token_hash(redemption->>'token'))
    on conflict (device_id) do update set
      redeemed_activation_id = excluded.redeemed_activation_id,
      redeemed_activation_token_hash = excluded.redeemed_activation_token_hash;
  end if;
  return redemption;
end;
$$;

revoke all on function private.yd_number_activation(),
  private.yd_can_recover_device_account(uuid, public.yd_app_accounts),
  private.yd_redeem_app_activation(text)
  from public, anon, authenticated;
revoke all on function public.yd_admin_device_enrollment(uuid),
  public.yd_admin_issue_device_activation(uuid, text, text),
  public.yd_redeem_app_activation(text)
  from public, anon, authenticated;
grant execute on function public.yd_admin_device_enrollment(uuid),
  public.yd_admin_issue_device_activation(uuid, text, text) to authenticated;
grant execute on function public.yd_redeem_app_activation(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
