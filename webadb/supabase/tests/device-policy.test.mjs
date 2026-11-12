import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.waitReady;

const owner = '00000000-0000-4000-8000-000000000001';
const adminA = '00000000-0000-4000-8000-000000000002';
const adminB = '00000000-0000-4000-8000-000000000003';
const customer = '00000000-0000-4000-8000-000000000004';
const legacyCustomer = '00000000-0000-4000-8000-000000000005';
const clientA = '10000000-0000-4000-8000-000000000001';
const clientB = '10000000-0000-4000-8000-000000000002';
const deviceB = '20000000-0000-4000-8000-000000000002';
const oldRequest = '30000000-0000-4000-8000-000000000001';
const newRequest = '30000000-0000-4000-8000-000000000002';
const serial = 'fixture-usb-serial-a';
const email = 'customer@example.invalid';
const phone = '+33123456789';

await db.exec(`
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema extensions;
create schema storage;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, banned_until timestamptz);
create table auth.sessions(id uuid primary key, user_id uuid references auth.users, not_after timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
-- Local stand-in for the pgcrypto byte generator, unavailable in PGlite.
create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile as $$
  select substring(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')) from 1 for n)
$$;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant select, insert, update on storage.objects to anon, authenticated;
`);

const loadMigration = async (name) => {
  const sql = await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8');
  await db.exec(sql.replaceAll('create extension if not exists pgcrypto;', ''));
};

for (const file of [
  '20261006000000_reseller_admin.sql',
  '20261007000000_owner_admin_portal.sql',
  '20261029000000_mdm_catalog_and_site_requests.sql',
  '20261030000000_admin_access_control.sql',
  '20261030000000_catalog_releases_and_revocation.sql',
  '20261106135728_app_customer_access.sql',
]) {
  await loadMigration(file);
}

for (const [id, name] of [
  [owner, 'owner'], [adminA, 'admin-a'], [adminB, 'admin-b'],
  [customer, 'customer'], [legacyCustomer, 'legacy-customer'],
]) {
  await db.query('insert into auth.users(id, email, email_confirmed_at) values ($1, $2, now())', [id, name + '@example.invalid']);
  await db.query('insert into auth.sessions(id, user_id) values ($1, $1)', [id]);
}
for (const [id, role] of [[owner, 'owner'], [adminA, 'admin'], [adminB, 'admin']]) {
  await db.query('insert into public.platform_admins(user_id, role) values ($1, $2)', [id, role]);
}
await db.query("insert into public.clients(id, user_id, name) values ($1,$2,'A'),($3,$4,'B')", [clientA, adminA, clientB, adminB]);
await db.query("insert into public.devices(id, user_id, name, platform) values ($1,$2,'B','Android')", [deviceB, adminB]);
await db.query("insert into public.yd_site_requests(device_id,client_request_id,site_url,status) values ($1,$2,'https://legacy.example/','approved')", [deviceB, oldRequest]);
await act('authenticated', owner);
await db.query('select public.set_device_configured($1,true)', [deviceB]);
await act('authenticated', legacyCustomer);
const legacyProfile = await scalar('select public.yd_complete_app_profile($1)', [phone]);
await act('authenticated', adminB);
const legacyPairCode = await scalar('select public.yd_create_pairing($1)', [deviceB]);
await act('authenticated', legacyCustomer);
const legacyDevice = await scalar('select public.yd_pair_device($1)', [legacyPairCode]);
await db.exec('reset role');

const migration = '20261111143137_device_policies_and_usb_activation.sql';
await loadMigration(migration);
await loadMigration(migration);
const appRequestMigration = '20261112141920_offline_app_access_requests.sql';
await loadMigration(appRequestMigration);

async function act(role, uid = '', live = true, token = '') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(live && uid ? { session_id: uid } : {})]);
  await db.query("select set_config('request.headers', $1, false)", [JSON.stringify(token ? { 'x-yidream-app-token': token } : {})]);
  await db.exec('set role ' + role);
}

async function scalar(sql, params = []) {
  return Object.values((await db.query(sql, params)).rows[0])[0];
}

const verify = (id, serialNumber = serial) => scalar('select public.yd_verify_usb_target($1,$2)', [id, serialNumber]);
const register = (id = null, serialNumber = serial) => scalar(
  'select public.yd_register_usb_device($1,$2,$3,$4)', [serialNumber, 'Phone A', 'Qin test model', id],
);
const issue = (id, address = email) => scalar('select public.yd_issue_app_activation($1,$2,$3)', [id, address, phone]);
const redeem = (code) => scalar('select public.yd_redeem_app_activation($1)', [code]);
const adminPolicy = (id) => scalar('select public.yd_admin_device_policy($1)', [id]);
const setRule = (id, kind, target, allowed) => scalar('select public.yd_set_device_rule($1,$2,$3,$4)', [id, kind, target, allowed]);
const phonePolicy = (token) => scalar('select public.yd_get_device_policy($1)', [token]);
const report = (token, revision, applied) => scalar('select public.yd_report_device_policy($1,$2,$3)', [token, revision, applied]);
const access = (token) => scalar('select public.yd_app_access_status($1)', [token]);

await act('anon');
await assert.rejects(() => verify(null), /permission denied/);
await assert.rejects(() => register(), /permission denied/);
await assert.rejects(() => phonePolicy('invalid'), /APP_ACCESS_DENIED/);
await assert.rejects(() => db.query('select * from private.yd_pending_app_activation'), /permission denied/);

await act('authenticated', customer);
await assert.rejects(() => register(), /APP_ACCESS_DENIED/);
await assert.rejects(() => db.query('select public.yd_complete_app_profile($1)', [phone]), /APP_ACCESS_DENIED/);
await assert.rejects(() => access(null), /APP_ACCESS_DENIED/);
await act('authenticated', legacyCustomer);
assert.equal((await access(null)).device_id, deviceB);
assert.equal((await scalar('select public.yd_complete_app_profile($1)', ['+33123456780'])).account.id, legacyProfile.account.id);
assert.deepEqual((await phonePolicy(legacyDevice.token)).sites, { 'legacy.example': true });
await act('authenticated', adminA, false);
await assert.rejects(() => register(), /APP_ACCESS_DENIED/);
await act('authenticated', adminA);
assert.equal(await verify(null), true);
const prepared = await register();
const id = prepared.device_id;
assert.match(id, /^[0-9a-f-]{36}$/);
assert.equal(prepared.configuration_status, 'needs_configuration');
assert.deepEqual(await register(), prepared);
assert.equal(await verify(id), true);
assert.equal(await verify(id, 'different-phone'), false);
await assert.rejects(() => register(id, 'different-phone'), /USB_DEVICE_MISMATCH/);
await assert.rejects(() => issue(id), /CONFIGURED_DEVICE_REQUIRED/);
await assert.rejects(() => setRule(id, 'app', 'com.whatsapp', false), /CONFIGURED_DEVICE_REQUIRED/);
await assert.rejects(() => db.query('select public.set_device_configured($1,true)', [id]), /propriétaire/);

await act('authenticated', adminB);
assert.equal(await verify(null), false);
assert.equal(await verify(id), false);
await assert.rejects(() => register(), /DEVICE_NOT_AVAILABLE/);
await assert.rejects(() => adminPolicy(id), /DEVICE_NOT_AVAILABLE/);
assert.deepEqual((await adminPolicy(deviceB)).sites, { 'legacy.example': true });

await act('authenticated', owner);
await db.query('select public.set_device_configured($1,true)', [id]);
await act('authenticated', adminA);
const assigned = await scalar('select public.yd_assign_device_client($1,$2)', [id, clientA]);
assert.deepEqual(assigned, { device_id: id, client_id: clientA, configuration_status: 'configured' });
await assert.rejects(() => db.query('select public.yd_assign_device_client($1,$2)', [id, clientB]), /CLIENT_NOT_AVAILABLE/);
await assert.rejects(() => setRule(id, 'site', '127.0.0.1', true), /INVALID_DEVICE_RULE/);
await assert.rejects(() => setRule(id, 'site', 'example.org@evil.test', true), /INVALID_DEVICE_RULE/);
await assert.rejects(() => setRule(id, 'app', 'com.yidream.mdm', false), /INVALID_DEVICE_RULE/);
const rule = await setRule(id, 'app', 'com.whatsapp', false);
assert.equal(rule.revision, 1);
assert.deepEqual(rule.apps, { 'com.whatsapp': false });
assert.equal((await setRule(id, 'app', 'com.whatsapp', false)).revision, 1);

const activation = await issue(id, email.toUpperCase());
assert.match(activation.code, /^[0-9A-F]{32}$/);
assert.ok(Date.parse(activation.expires_at) > Date.now() + 14 * 60_000);
await act('anon');
await assert.rejects(
  () => db.query('select public.yd_activate_app_code($1,$2,$3)', [activation.code, 'substituted@example.invalid', phone]),
  /INVALID_ACCOUNT_CODE/,
);
const session = await redeem(activation.code);
assert.equal(session.account.email, email);
assert.equal(session.account.contact_phone, phone);
assert.equal(session.account.email_verified, false);
assert.equal(session.device_id, id);
assert.ok(Date.parse(session.expires_at) > Date.now() + 89 * 86_400_000);
await assert.rejects(() => redeem(activation.code), /INVALID_ACCOUNT_CODE/);
await assert.rejects(() => phonePolicy(session.token), /APP_ACCESS_DENIED/);
await act('anon', '', true, session.app_token);
assert.deepEqual((await phonePolicy(session.token)).apps, { 'com.whatsapp': false });
assert.equal((await report(session.token, 99, true)).last_sync_at, null);
assert.equal((await report(session.token, 1, false)).apply_failed, true);
const applied = await report(session.token, 1, true);
assert.equal(applied.applied_revision, 1);
assert.equal(applied.apply_failed, false);
assert.ok(applied.last_sync_at);

await assert.rejects(() => db.query('select public.yd_request_site_change($1,$2,$3,$4,$5)',
  [session.token, 'https://allowed.example@evil.test/', '', newRequest, false]), /INVALID_SITE_REQUEST/);
await db.query('select public.yd_request_site_change($1,$2,$3,$4,$5)',
  [session.token, 'https://safe.example/path', 'Block this site', newRequest, false]);
await db.query('select public.yd_request_site_change($1,$2,$3,$4,$5)',
  [session.token, 'https://different.example/path', '', newRequest, true]);
const requests = (await db.query('select * from public.yd_device_requests($1)', [session.token])).rows;
assert.equal(requests.length, 1);
assert.equal(requests[0].requested_allowed, false);

await act('authenticated', adminB);
await assert.rejects(() => db.query("select public.yd_review_site($1,'approved')", [requests[0].id]), /DEVICE_NOT_AVAILABLE/);
await act('authenticated', adminA);
await setRule(id, 'site', 'SAFE.EXAMPLE', true);
await db.query("select public.yd_review_site($1,'approved')", [requests[0].id]);
assert.deepEqual((await adminPolicy(id)).sites, { 'safe.example': false });
await act('anon', '', true, session.app_token);
const updated = await phonePolicy(session.token);
assert.equal(updated.revision, 3);
assert.equal((await report(session.token, 1, true)).applied_revision, 1);
assert.equal((await report(session.token, 3, true)).applied_revision, 3);

const appRequest = '40000000-0000-4000-8000-000000000001';
const pendingAppRequest = '40000000-0000-4000-8000-000000000002';
const requestApp = (token, packageName, requestId, reason = '') => scalar(
  'select public.yd_request_app_access($1,$2,$3,$4)', [token, packageName, reason, requestId]
);
const deviceAppRequests = async token =>
  (await db.query('select * from public.yd_device_app_requests($1)', [token])).rows;
const adminAppRequests = async () => (await db.query('select * from public.yd_admin_app_requests()')).rows;
const reviewApp = (requestId, decision, note = '') => db.query(
  'select public.yd_review_app_access($1,$2,$3)', [requestId, decision, note]
);

for (const packageName of ['com.android.vending', 'com.android.settings', 'com.yidream.mdm', 'com.invalid;package']) {
  await assert.rejects(() => requestApp(session.token, packageName, appRequest), /INVALID_APP_REQUEST/);
}
assert.deepEqual(await requestApp(session.token, 'com.whatsapp', appRequest, 'Allow my installed app'), {});
assert.deepEqual(await requestApp(session.token, 'com.example.other', appRequest), {});
const [appRow] = await deviceAppRequests(session.token);
assert.equal((await deviceAppRequests(session.token)).length, 1);
assert.equal(appRow.package_name, 'com.whatsapp');
assert.equal(appRow.status, 'pending');
await assert.rejects(() => adminAppRequests(), /permission denied/);
await assert.rejects(() => db.query('select * from private.yd_app_access_requests'), /permission denied/);

await act('anon');
await assert.rejects(() => requestApp(session.token, 'com.whatsapp', appRequest), /APP_ACCESS_DENIED/);
await act('authenticated', legacyCustomer);
assert.deepEqual(await deviceAppRequests(legacyDevice.token), []);
await act('authenticated', adminB);
assert.deepEqual(await adminAppRequests(), []);
await assert.rejects(() => reviewApp(appRow.id, 'approved'), /APP_REQUEST_NOT_AVAILABLE/);
await act('authenticated', adminA, false);
await assert.rejects(() => adminAppRequests(), /APP_ACCESS_DENIED/);
await act('authenticated', adminA);
assert.equal((await adminAppRequests())[0].id, appRow.id);
await reviewApp(appRow.id, 'approved', 'Available on this device');
assert.equal((await adminPolicy(id)).apps['com.whatsapp'], true);
await reviewApp(appRow.id, 'revoked');
assert.equal((await adminPolicy(id)).apps['com.whatsapp'], false);
await act('anon', '', true, session.app_token);
assert.equal((await deviceAppRequests(session.token))[0].status, 'revoked');
assert.deepEqual(await requestApp(session.token, 'com.example.pending', pendingAppRequest), {});
const staleAppRow = (await deviceAppRequests(session.token)).find(r => r.client_request_id === pendingAppRequest);

await db.exec('reset role');
await db.query("update public.yd_device_links set app_session_expires_at=now()+interval '1 day' where device_id=$1", [id]);
await act('anon');
assert.ok(Date.parse((await access(session.app_token)).expires_at) > Date.now() + 89 * 86_400_000);

await act('authenticated', adminA);
const pending = await issue(id);
await act('anon');
assert.equal((await access(session.app_token)).account.id, session.account.id);
const renewed = await redeem(pending.code);
assert.equal(renewed.account.id, session.account.id);
await assert.rejects(() => access(session.app_token), /APP_ACCESS_DENIED/);
await act('anon', '', true, renewed.app_token);
assert.equal((await phonePolicy(renewed.token)).applied_revision, 0);

await act('authenticated', adminA);
const beforeSuspension = await issue(id);
await db.query('select public.yd_set_app_account_access($1,false)', [session.account.id]);
await db.query('select public.yd_set_app_account_access($1,true)', [session.account.id]);
await act('anon');
await assert.rejects(() => redeem(beforeSuspension.code), /INVALID_ACCOUNT_CODE/);

await act('authenticated', adminA);
const expiredClaim = await issue(id);
await db.exec('reset role');
await db.query("update private.yd_pending_app_activation set expires_at=now()-interval '1 second' where device_id=$1", [id]);
await act('anon');
await assert.rejects(() => redeem(expiredClaim.code), /INVALID_ACCOUNT_CODE/);
await act('authenticated', adminA);
const inactiveIssuerClaim = await issue(id);
await db.exec('reset role');
await db.query('update public.platform_admins set is_active=false where user_id=$1', [adminA]);
await act('authenticated', adminA);
await assert.rejects(() => adminPolicy(id), /APP_ACCESS_DENIED/);
await act('anon', '', true, renewed.app_token);
await assert.rejects(() => phonePolicy(renewed.token), /APP_ACCESS_DENIED/);
await assert.rejects(() => redeem(inactiveIssuerClaim.code), /INVALID_ACCOUNT_CODE/);

await db.exec('reset role');
await loadMigration(migration);
await loadMigration(appRequestMigration);
await act('authenticated', owner);
assert.deepEqual((await adminPolicy(id)).sites, { 'safe.example': false });
const replacementClaim = await issue(id, 'replacement@example.invalid');
await act('anon');
const replacement = await redeem(replacementClaim.code);
await act('anon', '', true, replacement.app_token);
assert.deepEqual(await deviceAppRequests(replacement.token), []);
await act('authenticated', owner);
await assert.rejects(() => reviewApp(staleAppRow.id, 'approved'), /APP_REQUEST_NOT_AVAILABLE/);

await db.exec('reset role');
await loadMigration('20261112143012_managed_accounts_and_site_windows.sql');
await db.query('update public.platform_admins set is_active=true where user_id=$1', [adminA]);

const createAccount = (address, number = phone) => scalar(
  'select public.yd_admin_create_app_account($1,$2)', [address, number]
);
const assignAccount = (accountId, deviceId = id) => scalar(
  'select public.yd_admin_assign_app_account($1,$2)', [accountId, deviceId]
);
const listAccounts = async () => (await db.query('select * from public.yd_list_app_accounts_v2()')).rows;
const setAccountAccess = (accountId, enabled) => db.query(
  'select public.yd_set_app_account_access($1,$2)', [accountId, enabled]
);
const setWindow = (deviceId, host, expiry) => scalar(
  'select public.yd_set_temporary_site_rule($1,$2,$3)', [deviceId, host, expiry]
);
const phonePolicyV2 = (token) => scalar('select public.yd_get_device_policy_v2($1)', [token]);
const reportV2 = (token, revision, applied) => scalar(
  'select public.yd_report_device_policy_v2($1,$2,$3)', [token, revision, applied]
);
const requestWindow = (token, url, requestId, hours = null, until = null) => scalar(
  'select public.yd_request_site_window($1,$2,$3,$4,$5,$6)', [token, url, 'Trip', requestId, hours, until]
);
const deviceSiteRequests = async (token) => (
  await db.query('select * from public.yd_device_requests($1)', [token])
).rows;
const reviewSite = (requestId, decision) => db.query('select public.yd_review_site($1,$2)', [requestId, decision]);
const siteRequest = (token, clientRequestId) => deviceSiteRequests(token).then(
  (rows) => rows.find((row) => row.client_request_id === clientRequestId)
);

await act('anon');
await assert.rejects(() => createAccount(email), /permission denied/);
await assert.rejects(() => listAccounts(), /permission denied/);
await assert.rejects(() => db.query('select * from private.yd_temporary_site_rules'), /permission denied/);
await act('authenticated', adminA, false);
await assert.rejects(() => createAccount(email), /APP_ACCESS_DENIED/);
await assert.rejects(() => listAccounts(), /APP_ACCESS_DENIED/);
await act('authenticated', adminA);
await assert.rejects(() => createAccount('not-an-email'), /INVALID_CONTACT/);
const managed = await createAccount('  NEW-CUSTOMER@EXAMPLE.INVALID  ');
assert.equal(managed.email, 'new-customer@example.invalid');
assert.equal(managed.device_id, null);
assert.equal(managed.pending_device_id, null);
assert.equal(managed.can_assign, true);
assert.equal((await listAccounts()).find((row) => row.id === managed.id).device_id, null);
assert.equal((await listAccounts()).find((row) => row.id === replacement.account.id).can_assign, false);
await assert.rejects(() => assignAccount(managed.id, deviceB), /DEVICE_NOT_AVAILABLE/);

await act('authenticated', adminB);
assert.ok(!(await listAccounts()).some((row) => row.id === managed.id));
await assert.rejects(() => assignAccount(managed.id, deviceB), /APP_ACCOUNT_NOT_AVAILABLE/);
await assert.rejects(() => setAccountAccess(managed.id, false), /APP_ACCESS_DENIED/);
await act('authenticated', owner);
assert.ok((await listAccounts()).some((row) => row.id === managed.id));

await act('authenticated', adminA);
const firstAssignment = await assignAccount(managed.id);
assert.equal(firstAssignment.account_id, managed.id);
assert.equal(firstAssignment.device_id, id);
assert.equal((await listAccounts()).find((row) => row.id === managed.id).pending_device_id, id);
assert.equal((await listAccounts()).find((row) => row.id === managed.id).device_id, null);
await act('anon');
assert.equal((await access(replacement.app_token)).account.id, replacement.account.id);
await act('authenticated', adminA);
await setAccountAccess(managed.id, false);
assert.equal((await listAccounts()).find((row) => row.id === managed.id).pending_device_id, null);
await setAccountAccess(managed.id, true);
await act('anon');
await assert.rejects(() => redeem(firstAssignment.code), /INVALID_ACCOUNT_CODE/);

await act('authenticated', adminA);
const overwrittenAssignment = await assignAccount(managed.id);
const legacyIssue = await issue(id, replacement.account.email);
assert.equal((await listAccounts()).find((row) => row.id === managed.id).pending_device_id, null);
await act('anon');
await assert.rejects(() => redeem(overwrittenAssignment.code), /INVALID_ACCOUNT_CODE/);
assert.equal((await redeem(legacyIssue.code)).account.id, replacement.account.id);

await act('authenticated', adminA);
const managedIssue = await assignAccount(managed.id);
await act('anon');
const managedPhone = await redeem(managedIssue.code);
assert.equal(managedPhone.account.id, managed.id);
assert.equal(managedPhone.device_id, id);
await assert.rejects(() => redeem(managedIssue.code), /INVALID_ACCOUNT_CODE/);
await act('authenticated', adminA);
assert.equal((await listAccounts()).find((row) => row.id === managed.id).device_id, id);
await act('authenticated', owner);
await assert.rejects(() => assignAccount(managed.id, deviceB), /APP_ACCOUNT_ALREADY_LINKED/);

const dailyRequest = '50000000-0000-4000-8000-000000000001';
const tripRequest = '50000000-0000-4000-8000-000000000002';
const invalidRequest = '50000000-0000-4000-8000-000000000003';
const staleSiteRequest = '50000000-0000-4000-8000-000000000004';
const tripExpiry = new Date(Date.now() + 3 * 86_400_000).toISOString();
await act('anon', '', true, managedPhone.app_token);
const beforeWindow = await phonePolicyV2(managedPhone.token);
assert.deepEqual(beforeWindow.temporary_sites, {});
assert.ok(Date.parse(beforeWindow.server_time) > 0);
await assert.rejects(() => requestWindow(managedPhone.token, 'http://site.example/', invalidRequest, 24), /INVALID_SITE_REQUEST/);
await assert.rejects(() => requestWindow(managedPhone.token, 'https://site.example/', invalidRequest, 25), /INVALID_SITE_WINDOW/);
await assert.rejects(
  () => requestWindow(managedPhone.token, 'https://site.example/', invalidRequest, 24, tripExpiry),
  /INVALID_SITE_WINDOW/,
);
await assert.rejects(
  () => requestWindow(managedPhone.token, 'https://site.example/', invalidRequest, null, '2020-01-01T00:00:00Z'),
  /INVALID_SITE_WINDOW/,
);
assert.deepEqual(await requestWindow(managedPhone.token, 'https://safe.example/', dailyRequest, 24), {});
assert.deepEqual(await requestWindow(managedPhone.token, 'https://safe.example/', dailyRequest, 24), {});
assert.deepEqual(await requestWindow(managedPhone.token, 'https://trip.example/', tripRequest, null, tripExpiry), {});
assert.deepEqual(await requestWindow(managedPhone.token, 'https://new.example/', staleSiteRequest, 24), {});
const daily = await siteRequest(managedPhone.token, dailyRequest);
const trip = await siteRequest(managedPhone.token, tripRequest);
const staleSite = await siteRequest(managedPhone.token, staleSiteRequest);
assert.equal(daily.requested_hours, 24);
assert.equal(daily.allowed_until, null);
assert.equal(new Date(trip.requested_until).getTime(), Date.parse(tripExpiry));

await act('authenticated', adminB);
await assert.rejects(() => reviewSite(daily.id, 'approved'), /DEVICE_NOT_AVAILABLE/);
await assert.rejects(() => setWindow(id, 'safe.example', tripExpiry), /DEVICE_NOT_AVAILABLE/);
await act('authenticated', adminA);
await reviewSite(daily.id, 'approved');
await reviewSite(trip.id, 'approved');
const withWindows = await adminPolicy(id);
assert.equal(withWindows.sites['safe.example'], false);
assert.ok(Date.parse(withWindows.temporary_sites['safe.example']) > Date.now() + 23.9 * 60 * 60_000);
assert.equal(Date.parse(withWindows.temporary_sites['trip.example']), Date.parse(tripExpiry));
assert.equal(withWindows.sites['trip.example'], undefined);

await act('anon', '', true, managedPhone.app_token);
const legacyWindowPolicy = await phonePolicy(managedPhone.token);
assert.equal(legacyWindowPolicy.temporary_sites, undefined);
assert.equal(legacyWindowPolicy.sites['trip.example'], undefined);
assert.equal((await report(managedPhone.token, withWindows.revision, true)).applied_revision, 0);
assert.equal((await phonePolicyV2(managedPhone.token)).temporary_sites['trip.example'], withWindows.temporary_sites['trip.example']);
assert.equal((await reportV2(managedPhone.token, withWindows.revision, true)).applied_revision, withWindows.revision);
assert.equal((await report(managedPhone.token, withWindows.revision, false)).apply_failed, false);
assert.ok((await siteRequest(managedPhone.token, dailyRequest)).allowed_until instanceof Date);

await act('authenticated', adminA);
const manual = await setWindow(id, 'trip.example', new Date(Date.now() + 86_400_000).toISOString());
await reviewSite(trip.id, 'revoked');
assert.equal((await adminPolicy(id)).temporary_sites['trip.example'], manual.temporary_sites['trip.example']);
await setRule(id, 'site', 'safe.example', false);
assert.equal((await adminPolicy(id)).temporary_sites['safe.example'], undefined);
assert.equal((await adminPolicy(id)).revision, manual.revision + 1);
await assert.rejects(() => setWindow(id, 'https://malformed.example/', tripExpiry), /INVALID_SITE_WINDOW/);

await db.exec('reset role');
await db.query("update private.yd_temporary_site_rules set expires_at=now()-interval '1 second' where device_id=$1", [id]);
await act('anon', '', true, managedPhone.app_token);
const afterExpiry = await phonePolicyV2(managedPhone.token);
assert.deepEqual(afterExpiry.temporary_sites, {});
assert.deepEqual(afterExpiry.sites, { 'safe.example': false });
assert.equal(afterExpiry.revision, manual.revision + 1);
assert.equal((await siteRequest(managedPhone.token, tripRequest)).status, 'revoked');
assert.equal(new Date((await siteRequest(managedPhone.token, tripRequest)).allowed_until).getTime(), Date.parse(tripExpiry));

await act('authenticated', adminA);
await reviewSite(daily.id, 'revoked');
await reviewSite(daily.id, 'approved');
const nextAccount = await createAccount('another-customer@example.invalid');
const nextClaim = await assignAccount(nextAccount.id);
await act('anon', '', true, managedPhone.app_token);
assert.ok((await phonePolicyV2(managedPhone.token)).temporary_sites['safe.example']);
assert.equal((await access(managedPhone.app_token)).account.id, managed.id);
const nextPhone = await redeem(nextClaim.code);
await assert.rejects(() => access(managedPhone.app_token), /APP_ACCESS_DENIED/);
await act('anon', '', true, nextPhone.app_token);
assert.deepEqual((await phonePolicyV2(nextPhone.token)).temporary_sites, {});
assert.equal(await siteRequest(nextPhone.token, dailyRequest), undefined);
await act('authenticated', adminA);
await assert.rejects(() => reviewSite(staleSite.id, 'approved'), /SITE_REQUEST_NOT_AVAILABLE/);

// The USB wizard created code accounts before managed account records existed.
const recoveryDevice = (await register(null, 'fixture-usb-recovery')).device_id;
await act('authenticated', owner);
await db.query('select public.set_device_configured($1,true)', [recoveryDevice]);
await act('authenticated', adminA);
const initialRecoveryCode = await issue(recoveryDevice);
await act('anon');
const recoverySession = await redeem(initialRecoveryCode.code);

await db.exec('reset role');
const recoveryMigration = '20261112151343_reissue_legacy_device_activation.sql';
await loadMigration(recoveryMigration);
await loadMigration(recoveryMigration);
await act('anon');
await assert.rejects(() => assignAccount(recoverySession.account.id, recoveryDevice), /permission denied/);
await act('authenticated', customer);
await assert.rejects(() => assignAccount(recoverySession.account.id, recoveryDevice), /APP_ACCESS_DENIED/);
await act('authenticated', adminB);
assert.ok(!(await listAccounts()).some((row) => row.id === recoverySession.account.id));
await assert.rejects(() => assignAccount(recoverySession.account.id, recoveryDevice), /APP_ACCOUNT_NOT_AVAILABLE/);
assert.equal((await listAccounts()).find((row) => row.id === legacyProfile.account.id).can_assign, false);
await assert.rejects(() => assignAccount(legacyProfile.account.id, deviceB), /APP_ACCOUNT_NOT_AVAILABLE/);
await act('authenticated', owner);
await assert.rejects(() => assignAccount(recoverySession.account.id, deviceB), /APP_ACCOUNT_NOT_AVAILABLE/);

const otherRecoveryDevice = (await register(null, 'fixture-usb-recovery-other')).device_id;
await db.exec('reset role');
await db.query('insert into public.yd_device_links(device_id, account_id) values ($1, $2)',
  [otherRecoveryDevice, recoverySession.account.id]);
await act('authenticated', owner);
assert.ok((await listAccounts()).filter((row) => row.id === recoverySession.account.id)
  .every((row) => row.can_assign === false));
await assert.rejects(() => assignAccount(recoverySession.account.id, recoveryDevice), /APP_ACCOUNT_ALREADY_LINKED/);
await db.exec('reset role');
await db.query('delete from public.yd_device_links where device_id = $1', [otherRecoveryDevice]);

await act('authenticated', adminA);
assert.equal((await listAccounts()).find((row) => row.id === recoverySession.account.id).can_assign, true);
const cancelledRecovery = await assignAccount(recoverySession.account.id, recoveryDevice);
await setAccountAccess(recoverySession.account.id, false);
assert.equal((await listAccounts()).find((row) => row.id === recoverySession.account.id).can_assign, false);
await assert.rejects(() => assignAccount(recoverySession.account.id, recoveryDevice), /APP_ACCOUNT_NOT_AVAILABLE/);
await setAccountAccess(recoverySession.account.id, true);
await act('anon');
await assert.rejects(() => redeem(cancelledRecovery.code), /INVALID_ACCOUNT_CODE/);

await act('authenticated', adminA);
const recovery = await assignAccount(recoverySession.account.id, recoveryDevice);
assert.equal(recovery.account_id, recoverySession.account.id);
assert.equal(recovery.device_id, recoveryDevice);
await act('anon', '', true, recoverySession.app_token);
assert.equal((await access(recoverySession.app_token)).account.id, recoverySession.account.id);
await phonePolicy(recoverySession.token);
const recovered = await redeem(recovery.code);
assert.deepEqual(recovered.account, recoverySession.account);
assert.equal(recovered.device_id, recoveryDevice);
await assert.rejects(() => access(recoverySession.app_token), /APP_ACCESS_DENIED/);
await assert.rejects(() => redeem(recovery.code), /INVALID_ACCOUNT_CODE/);
await act('anon', '', true, recovered.app_token);
await phonePolicy(recovered.token);

await db.close();
console.log('Device rules: USB identity, account and shop isolation, activation, policy delivery, and permanent and timed requests passed.');
