-- Restore same-device activation for accounts created by the USB setup wizard.
-- Keep the original account and active credentials until the new code is redeemed.
begin;

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
    left join private.yd_managed_app_accounts m on m.account_id = a.id
    where a.id = yd_admin_assign_app_account.account_id and a.is_active and a.auth_user_id is null
      and (
        (m.account_id is not null and (m.shop_id = actor or public.is_platform_owner()))
        or (m.account_id is null and exists (
          select 1 from public.yd_device_links l join public.devices d on d.id = l.device_id
          where l.account_id = a.id and l.device_id = target_device
            and (d.user_id = actor or public.is_platform_owner())
        ))
      )
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
  -- A legacy code account keeps its existing link and is reused on redemption
  -- by matching its stored contact details. Only managed accounts use assigned_account_id.
  update private.yd_pending_app_activation c set assigned_account_id = account.id
    where c.device_id = device.id and exists (
      select 1 from private.yd_managed_app_accounts m where m.account_id = account.id
    );
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
      a.is_active and a.auth_user_id is null and v.can_manage and (
        (m.account_id is not null and (m.shop_id = actor or owner))
        or (m.account_id is null and v.device_id is not null and not exists (
          select 1 from public.yd_device_links l where l.account_id = a.id and l.device_id <> v.device_id
        ))
      )
    from visible v join public.yd_app_accounts a on a.id = v.account_id
    left join private.yd_managed_app_accounts m on m.account_id = a.id
    left join private.yd_pending_app_activation c on c.assigned_account_id = a.id and c.expires_at > now()
      and private.yd_valid_device_issuer(c.issued_by)
      and (owner or exists (select 1 from public.devices d where d.id = c.device_id and d.user_id = actor))
    order by a.created_at desc, v.device_name, a.id;
end;
$$;

commit;
