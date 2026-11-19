begin;

-- The official stable Zemer release is available to every paired device through
-- the existing catalogue. Catalogue metadata is not an app permission: Android
-- still requires Zemer to be installed and allowed before updating it; a first
-- install requires the existing explicit per-device approval.
-- Source: https://github.com/ZemerTeam/zemer-app/releases/tag/v41
-- Downloaded APK verified with Google's apksig 8.13.2 on 2026-11-19:
-- com.jtech.zemer, versionCode 41, versionName 41, minSdk 26, not debuggable.
-- Signing certificate SHA-256:
-- 89cd74c05a2bf5d50e742614926d5e5d015b9b344d8576963f130310347b10f5
-- The APK digest below also matches the GitHub release asset digest.
do $$
declare
  publisher uuid;
begin
  select user_id into publisher from public.platform_admins
    where role = 'owner' and is_active = true order by user_id limit 1;
  if publisher is not null then
    -- Do not silently turn a pre-existing private publication into a shared app,
    -- or compete with a base release managed by another owner.
    if exists (
      select 1 from public.yd_catalog where package_name = 'com.jtech.zemer'
        and ((owner_id = publisher and not is_base) or (is_base and owner_id <> publisher))
    ) then
      raise exception 'ZEMER_CATALOG_CONFLICT';
    end if;
    insert into public.yd_catalog (
      owner_id, name, description, package_name, is_base, requires_device_approval,
      apk_url, sha256, version_code, version_name, source_url
    ) values (
      publisher, 'Zemer', 'Musique juive. Version stable officielle de zemer.io.',
      'com.jtech.zemer', true, true,
      'https://github.com/ZemerTeam/zemer-app/releases/download/v41/app-release.apk',
      'fdf0115f6ace608119c7dd57db62666d59ea8f8beb6465119848b9bd6d0a6edd',
      41, '41', 'https://zemer.io/'
    ) on conflict (owner_id, package_name) do nothing;
  end if;
end;
$$;

-- No device grants, application rules or install restrictions are modified.
commit;
notify pgrst, 'reload schema';
