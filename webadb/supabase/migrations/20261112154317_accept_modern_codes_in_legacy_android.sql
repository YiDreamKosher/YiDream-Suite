-- Keep Android 6.0 compatible with activation codes issued by the current Suite.
begin;

create or replace function public.yd_activate_app_code(
  account_code text, contact_email text, contact_phone text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  link public.yd_device_links;
  account public.yd_app_accounts;
  token text;
  session_token text;
  expires timestamptz;
  normalized_email text := lower(trim(contact_email));
  normalized_phone text := trim(contact_phone);
  normalized_code text;
  code_digest text;
  expected_email text;
  expected_phone text;
begin
  perform pg_advisory_xact_lock(673219843);
  if normalized_email is null or length(normalized_email) > 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or normalized_phone is null or normalized_phone !~ '^\+[1-9][0-9]{7,14}$'
  then
    raise exception 'INVALID_CONTACT';
  end if;
  if account_code is null or length(account_code) > 64 then
    raise exception 'INVALID_ACCOUNT_CODE';
  end if;
  normalized_code := upper(trim(account_code));
  if normalized_code !~ '^[0-9A-F]{32}$' then
    raise exception 'INVALID_ACCOUNT_CODE';
  end if;
  code_digest := public.yd_token_hash(normalized_code);

  -- Older APKs still call this RPC with contacts. Modern codes retain
  -- their current issuer, expiry, device and account checks on redemption.
  select c.email, c.contact_phone into expected_email, expected_phone
    from private.yd_pending_app_activation c where c.code_hash = code_digest;
  if found then
    if normalized_email is distinct from expected_email or normalized_phone is distinct from expected_phone then
      raise exception 'INVALID_ACCOUNT_CODE';
    end if;
    return public.yd_redeem_app_activation(normalized_code);
  end if;

  select l.* into link
    from public.yd_device_links l join public.devices d on d.id = l.device_id
    where l.pairing_hash = code_digest and l.pairing_expires_at > now()
      and d.configuration_status = 'configured' and private.yd_valid_device_issuer(l.pairing_created_by)
      and (d.user_id = l.pairing_created_by or exists (
        select 1 from public.platform_admins p
        where p.user_id = l.pairing_created_by and p.role = 'owner' and p.is_active
      ))
    for update of l;
  if link.device_id is null then
    raise exception 'INVALID_ACCOUNT_CODE';
  end if;

  insert into public.yd_app_accounts(email, contact_phone, email_verified, last_seen_at)
    values (normalized_email, normalized_phone, false, now()) returning * into account;
  token := encode(extensions.gen_random_bytes(32), 'hex');
  session_token := encode(extensions.gen_random_bytes(32), 'hex');
  expires := now() + interval '30 days';
  update public.yd_device_links set
    token_hash = public.yd_token_hash(token), account_id = account.id, access_issuer_id = link.pairing_created_by,
    pairing_hash = null, pairing_expires_at = null, pairing_created_by = null,
    app_session_hash = public.yd_token_hash(session_token), app_session_expires_at = expires
    where device_id = link.device_id;
  return jsonb_build_object('account', private.yd_account_json(account), 'device_id', link.device_id,
    'token', token, 'app_token', session_token, 'expires_at', expires);
end;
$$;

commit;
