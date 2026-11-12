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

// Match the provisioning code format without using any production key material.
await db.exec('reset role');
await db.exec(`
  create function extensions.hmac(data bytea, key bytea, algorithm text) returns bytea
  language sql immutable as $$ select sha256($1 || $2) $$;
`);
await loadMigration('20261008000000_android_admin_unlock_key.sql');
await loadMigration('20261112160453_android_owner_maintenance_code.sql');
const maintenanceCode = () => scalar('select public.get_android_maintenance_code()');

await act('anon');
await assert.rejects(maintenanceCode, /permission denied/);
await act('authenticated', customer);
await assert.rejects(maintenanceCode, /APP_ACCESS_DENIED/);
await act('authenticated', adminA);
await assert.rejects(maintenanceCode, /APP_ACCESS_DENIED/);
assert.ok((await scalar('select public.get_android_unlock_material()')).intermediate_key);
await act('authenticated', owner, false);
await assert.rejects(maintenanceCode, /APP_ACCESS_DENIED/);

await db.exec('reset role');
await db.query("update auth.sessions set not_after = now() - interval '1 second' where id = $1", [owner]);
await act('authenticated', owner);
await assert.rejects(maintenanceCode, /APP_ACCESS_DENIED/);
await db.exec('reset role');
await db.query('update auth.sessions set not_after = null where id = $1', [owner]);
await act('authenticated', owner);
const [{ material, maintenance }] = (await db.query(
  'select public.get_android_unlock_material() as material, public.get_android_maintenance_code() as maintenance'
)).rows;
assert.deepEqual(maintenance, { code: material.code, date: material.date });
assert.match(maintenance.code, /^[0-9A-F]{6}$/);
assert.match(maintenance.date, /^\d{4}-\d{2}-\d{2}$/);

// USB delivery does not confirm activation. Only the exact redeemed attempt and
// a report from its current credential can confirm synchronization.
await db.exec('reset role');
const enrollmentMigration = '20261112175239_confirm_device_activation.sql';
await loadMigration(enrollmentMigration);
await loadMigration(enrollmentMigration);
const enrollmentStatus = (target = id) => scalar('select public.yd_admin_device_enrollment($1)', [target]);
const issueEnrollment = (target = id, address = null, number = null) =>
  scalar('select public.yd_admin_issue_device_activation($1,$2,$3)', [target, address, number]);

await act('anon');
await assert.rejects(() => enrollmentStatus(), /permission denied/);
await assert.rejects(() => issueEnrollment(), /permission denied/);
await act('authenticated', adminB);
await assert.rejects(() => enrollmentStatus(), /DEVICE_NOT_AVAILABLE/);
await assert.rejects(() => issueEnrollment(), /DEVICE_NOT_AVAILABLE/);
assert.equal((await enrollmentStatus(deviceB)).can_issue, false);
await assert.rejects(() => issueEnrollment(deviceB), /ACCOUNT_RECOVERY_UNAVAILABLE/);
await act('authenticated', adminA);
assert.equal((await enrollmentStatus()).state, 'linked');
assert.equal((await enrollmentStatus()).needs_contact, false);
const superseded = await issueEnrollment();
const recovery = await issueEnrollment(id, 'ignored@example.invalid', '+33123456780');
assert.notEqual(recovery.activation_id, superseded.activation_id);
const beforeRedemption = await enrollmentStatus();
assert.equal(beforeRedemption.pending_activation_id, recovery.activation_id);
assert.equal(beforeRedemption.redeemed_activation_id, null);
assert.equal(beforeRedemption.code, undefined);
await act('anon', '', true, nextPhone.app_token);
assert.equal((await access(nextPhone.app_token)).account.id, nextAccount.id);
await assert.rejects(() => redeem(superseded.code), /INVALID_ACCOUNT_CODE/);
const recoveredPhone = await redeem(recovery.code);
assert.equal(recoveredPhone.device_id, id);
assert.equal(recoveredPhone.account.id, nextAccount.id);
await assert.rejects(() => access(nextPhone.app_token), /APP_ACCESS_DENIED/);
await act('authenticated', adminA);
const receipt = await enrollmentStatus();
assert.equal(receipt.pending_activation_id, null);
assert.equal(receipt.redeemed_activation_id, recovery.activation_id);
assert.equal(receipt.last_sync_at, null);
await act('anon', '', true, recoveredPhone.app_token);
const recoveredPolicy = await phonePolicyV2(recoveredPhone.token);
await reportV2(recoveredPhone.token, recoveredPolicy.revision, true);
await act('authenticated', adminA);
assert.ok(Number.isFinite(Date.parse((await enrollmentStatus()).last_sync_at)));

const fresh = await register(null, 'fixture-usb-enrollment-fresh');
await assert.rejects(() => enrollmentStatus(fresh.device_id), /DEVICE_NOT_AVAILABLE/);
await act('authenticated', owner);
await scalar('select public.set_device_configured($1,true)', [fresh.device_id]);
await act('authenticated', adminA);
assert.equal((await enrollmentStatus(fresh.device_id)).state, 'unlinked');
assert.equal((await enrollmentStatus(fresh.device_id)).needs_contact, true);
await assert.rejects(() => issueEnrollment(fresh.device_id), /INVALID_CONTACT/);
const firstActivation = await issueEnrollment(fresh.device_id, 'new-device@example.invalid', phone);
await act('anon');
const firstPhone = await redeem(firstActivation.code);
assert.equal(firstPhone.device_id, fresh.device_id);
await act('authenticated', adminA);
assert.equal((await enrollmentStatus(fresh.device_id)).redeemed_activation_id, firstActivation.activation_id);

// Fleet controls remain device-bound and every legacy submission path is gated.
await db.exec('reset role');
const fleetMigration = '20261112183018_fleet_device_controls.sql';
await loadMigration(fleetMigration);
await loadMigration(fleetMigration);
const setControls = (deviceId, profile, apps, sites) => scalar(
  'select public.yd_admin_set_device_controls($1,$2,$3,$4)', [deviceId, profile, apps, sites]
);
const setPermissions = (ids, apps, sites) => scalar(
  'select public.yd_admin_set_request_permissions($1,$2,$3)', [ids, apps, sites]
);
const reviewScoped = (kind, requestId, decision, ids = null, all = false) => scalar(
  "select public.yd_review_device_request($1,$2,$3,'',$4,$5)", [kind, requestId, decision, ids, all]
);
const freshRequestId = () => crypto.randomUUID();
const requestLegacySite = (token, domain, requestId) => scalar(
  "select public.yd_request_site($1,$2,'',$3)", [token, 'https://' + domain, requestId]
);
const requestPermanent = (token, domain, requestId) => scalar(
  "select public.yd_request_site_change($1,$2,'',$3,true)", [token, 'https://' + domain, requestId]
);
const secondaryId = fresh.device_id;
await act('authenticated', adminA);
assert.equal((await adminPolicy(id)).app_requests_enabled, false);
assert.equal((await adminPolicy(id)).site_requests_enabled, false);
const staging = await register(null, 'fixture-staged-mp3');
assert.equal((await setControls(staging.device_id, 'mp3', false, false)).device_profile, 'mp3');
await assert.rejects(() => setPermissions([staging.device_id], true, null), /CONFIGURED_DEVICE_REQUIRED/);
await assert.rejects(() => setControls(deviceB, 'qin', false, false), /DEVICE_NOT_AVAILABLE/);
const initialPermissions = await adminPolicy(id);
await assert.rejects(() => setPermissions([id, deviceB], true, null), /DEVICE_NOT_AVAILABLE/);
assert.equal((await adminPolicy(id)).revision, initialPermissions.revision);
assert.equal(await setPermissions([id, secondaryId, id], null, true), 2);

await act('anon', '', true, recoveredPhone.app_token);
await assert.rejects(() => setControls(id, 'qin', true, true), /permission denied/);
await assert.rejects(() => requestApp(recoveredPhone.token, 'com.example.fleet', freshRequestId()), /REQUESTS_DISABLED/);
assert.deepEqual(await requestPermanent(recoveredPhone.token, 'enabled.example', freshRequestId()), {});
await act('authenticated', adminA);
assert.equal(await setPermissions([id], true, false), 1);
await act('anon', '', true, recoveredPhone.app_token);
assert.deepEqual(await requestApp(recoveredPhone.token, 'com.example.fleet', freshRequestId()), {});
await assert.rejects(() => requestPermanent(recoveredPhone.token, 'fleet.example', freshRequestId()), /REQUESTS_DISABLED/);
await assert.rejects(() => requestLegacySite(recoveredPhone.token, 'fleet.example', freshRequestId()), /REQUESTS_DISABLED/);
await assert.rejects(() => requestWindow(recoveredPhone.token, 'https://fleet.example', freshRequestId(), 24), /REQUESTS_DISABLED/);

await act('anon', '', true, firstPhone.app_token);
const priorSiteId = freshRequestId();
await requestLegacySite(firstPhone.token, 'queued-before-mp3.example', priorSiteId);
const priorSite = await siteRequest(firstPhone.token, priorSiteId);
await act('authenticated', adminA);
await setRule(secondaryId, 'site', 'existing.example', true);
await setWindow(secondaryId, 'existing-window.example', new Date(Date.now() + 86_400_000).toISOString());
assert.equal((await setControls(secondaryId, 'mp3', true, true)).site_requests_enabled, false);
await assert.rejects(() => setPermissions([secondaryId], null, true), /MP3_WEB_DISABLED/);
await assert.rejects(() => setRule(secondaryId, 'site', 'denied.example', true), /MP3_WEB_DISABLED/);
await assert.rejects(() => reviewSite(priorSite.id, 'approved'), /MP3_WEB_DISABLED/);
await act('anon', '', true, firstPhone.app_token);
assert.equal((await phonePolicy(firstPhone.token)).device_profile, 'mp3');
assert.deepEqual((await phonePolicy(firstPhone.token)).sites, {});
assert.deepEqual((await phonePolicyV2(firstPhone.token)).temporary_sites, {});
await assert.rejects(() => requestLegacySite(firstPhone.token, 'existing.example', freshRequestId()), /REQUESTS_DISABLED/);
const mp3AppId = freshRequestId();
assert.deepEqual(await requestApp(firstPhone.token, 'com.example.mp3', mp3AppId), {});
await act('authenticated', adminA);
const mp3App = (await adminAppRequests()).find(request => request.client_request_id === mp3AppId);
assert.equal(await reviewScoped('app', mp3App.id, 'rejected'), 1);
assert.equal((await adminPolicy(secondaryId)).apps['com.example.mp3'], undefined);
const fleetApp = (await adminAppRequests()).find(request => request.package_name === 'com.example.fleet');
await act('authenticated', owner);
await assert.rejects(() => reviewScoped('app', fleetApp.id, 'approved', [deviceB]), /INVALID_REQUEST_SCOPE/);
await act('authenticated', adminA);
assert.equal((await adminAppRequests()).find(request => request.id === fleetApp.id).status, 'pending');
assert.equal(await reviewScoped('app', fleetApp.id, 'approved', [secondaryId]), 2);
assert.equal((await adminPolicy(id)).apps['com.example.fleet'], true);
assert.equal((await adminPolicy(secondaryId)).apps['com.example.fleet'], true);
// Legacy single-request review still revokes every grant owned by the decision.
await reviewApp(fleetApp.id, 'revoked');
assert.equal((await adminPolicy(id)).apps['com.example.fleet'], false);
assert.equal((await adminPolicy(secondaryId)).apps['com.example.fleet'], false);
await setRule(secondaryId, 'app', 'com.example.fleet', true);
assert.equal(await reviewScoped('app', fleetApp.id, 'approved', null, true), 2);
assert.equal(await reviewScoped('app', fleetApp.id, 'revoked'), 2);
assert.equal((await adminPolicy(secondaryId)).apps['com.example.fleet'], true);

await setControls(id, 'qin', true, true);
await act('anon', '', true, recoveredPhone.app_token);
const fleetSiteId = freshRequestId();
await requestPermanent(recoveredPhone.token, 'fleet.example', fleetSiteId);
const fleetSite = await siteRequest(recoveredPhone.token, fleetSiteId);
assert.equal(fleetSite.requested_account_id, recoveredPhone.account.id);
await act('authenticated', adminA);
await assert.rejects(() => reviewScoped('site', fleetSite.id, 'approved', [secondaryId]), /MP3_WEB_DISABLED/);
assert.equal(await reviewScoped('site', fleetSite.id, 'approved', null, true), 1);
assert.equal((await adminPolicy(id)).sites['fleet.example'], true);
assert.equal((await adminPolicy(secondaryId)).sites['fleet.example'], undefined);
assert.equal((await setControls(secondaryId, 'qin', true, true)).sites['existing.example'], true);
assert.equal(await reviewScoped('site', fleetSite.id, 'revoked'), 1);
assert.equal(await reviewScoped('site', fleetSite.id, 'approved', [secondaryId]), 2);
assert.equal((await adminPolicy(secondaryId)).sites['fleet.example'], true);
// A direct rule on the destination takes precedence over a scoped decision.
await setRule(secondaryId, 'site', 'fleet.example', false);
assert.equal((await adminPolicy(secondaryId)).sites['fleet.example'], false);
assert.equal(await reviewScoped('site', fleetSite.id, 'revoked'), 1);
assert.equal((await adminPolicy(secondaryId)).sites['fleet.example'], false);
await act('authenticated', adminB);
assert.equal((await adminPolicy(deviceB)).sites['fleet.example'], undefined);

// A temporary approval shares the origin deadline without overwriting another
// grant or promoting the destination's window to a permanent rule.
await act('authenticated', adminA);
await setRule(secondaryId, 'site', 'existing-window.example', false);
await act('anon', '', true, recoveredPhone.app_token);
const scopedWindowId = freshRequestId();
const sharedDeadline = new Date(Date.now() + 172_800_000).toISOString();
await requestWindow(recoveredPhone.token, 'https://shared-window.example', scopedWindowId, null, sharedDeadline);
const scopedWindow = await siteRequest(recoveredPhone.token, scopedWindowId);
await act('authenticated', adminA);
assert.equal(await reviewScoped('site', scopedWindow.id, 'approved', null, true), 2);
const secondaryWindowPolicy = await adminPolicy(secondaryId);
assert.equal(secondaryWindowPolicy.sites['shared-window.example'], undefined);
assert.equal(Date.parse(secondaryWindowPolicy.temporary_sites['shared-window.example']), Date.parse(sharedDeadline));
assert.equal(secondaryWindowPolicy.temporary_sites['shared-window.example'],
  (await adminPolicy(id)).temporary_sites['shared-window.example']);
await act('anon', '', true, firstPhone.app_token);
assert.equal((await phonePolicy(firstPhone.token)).sites['shared-window.example'], undefined);
assert.equal((await report(firstPhone.token, secondaryWindowPolicy.revision, true)).applied_revision,
  secondaryWindowPolicy.applied_revision);
assert.equal((await reportV2(firstPhone.token, secondaryWindowPolicy.revision, true)).applied_revision,
  secondaryWindowPolicy.revision);
await act('authenticated', adminA);
const separateDeadline = new Date(Date.now() + 86_400_000).toISOString();
const overlappingWindow = await setWindow(secondaryId, 'shared-window.example', separateDeadline);
assert.equal(Date.parse(overlappingWindow.temporary_sites['shared-window.example']), Date.parse(sharedDeadline));
assert.equal(await reviewScoped('site', scopedWindow.id, 'revoked'), 2);
assert.equal((await adminPolicy(id)).temporary_sites['shared-window.example'], undefined);
assert.equal(Date.parse((await adminPolicy(secondaryId)).temporary_sites['shared-window.example']), Date.parse(separateDeadline));

await act('anon', '', true, recoveredPhone.app_token);
const scopedDailyId = freshRequestId();
await requestWindow(recoveredPhone.token, 'https://scoped-day.example', scopedDailyId, 24);
const scopedDaily = await siteRequest(recoveredPhone.token, scopedDailyId);
await act('authenticated', adminA);
assert.equal(await reviewScoped('site', scopedDaily.id, 'approved', [secondaryId]), 2);
assert.equal((await adminPolicy(secondaryId)).temporary_sites['scoped-day.example'],
  (await adminPolicy(id)).temporary_sites['scoped-day.example']);
await db.exec('reset role');
await db.query("update private.yd_scoped_request_grants set expires_at=now()-interval '1 second' where request_id=$1", [scopedDaily.id]);
await act('authenticated', adminA);
assert.equal((await adminPolicy(secondaryId)).temporary_sites['scoped-day.example'], undefined);
assert.equal((await adminPolicy(secondaryId)).sites['scoped-day.example'], undefined);

// Future shop publications require an approval on both the catalogue and the APK.
await act('authenticated', adminA);
await db.query(
  "insert into public.yd_catalog(owner_id,name,package_name) values ($1,'Existing publication','com.example.existingcatalog')",
  [adminA]
);
await db.exec('reset role');
const catalogueMigration = '20261112183610_scope_new_catalog_apps.sql';
await loadMigration(catalogueMigration);
await loadMigration(catalogueMigration);
const cataloguePackage = 'com.example.newcatalog';
const cataloguePath = adminA + '/' + cataloguePackage + '/release.apk';
await act('authenticated', adminA);
await db.query(
  "insert into public.yd_catalog(owner_id,name,package_name,storage_path,apk_url,sha256,version_code) values ($1,'New publication',$2,$3,'https://example.invalid/release.apk',repeat('a',64),1)",
  [adminA, cataloguePackage, cataloguePath]
);
const hasCatalogue = (token, name) => scalar(
  'select exists(select 1 from public.yd_device_catalog($1) where package_name=$2)', [token, name]
);
async function canReadCatalogueApk(phone) {
  await act('anon', '', true, phone.app_token);
  await db.query("select set_config('request.headers',$1,false)", [
    JSON.stringify({ 'x-yidream-app-token': phone.app_token, 'x-yidream-device-token': phone.token })
  ]);
  return scalar('select public.yd_can_read_apk($1)', [cataloguePath]);
}
assert.equal(await canReadCatalogueApk(recoveredPhone), false);
assert.equal(await hasCatalogue(recoveredPhone.token, cataloguePackage), false);
assert.equal(await hasCatalogue(recoveredPhone.token, 'com.example.existingcatalog'), true);
const catalogueRequestId = freshRequestId();
await requestApp(recoveredPhone.token, cataloguePackage, catalogueRequestId);
await act('authenticated', adminA);
const catalogueRequest = (await adminAppRequests()).find(request => request.client_request_id === catalogueRequestId);
await reviewScoped('app', catalogueRequest.id, 'approved');
assert.equal(await canReadCatalogueApk(recoveredPhone), true);
assert.equal(await hasCatalogue(recoveredPhone.token, cataloguePackage), true);
assert.equal(await canReadCatalogueApk(firstPhone), false);
assert.equal(await hasCatalogue(firstPhone.token, cataloguePackage), false);
await act('authenticated', adminA);
await reviewScoped('app', catalogueRequest.id, 'revoked');
assert.equal(await canReadCatalogueApk(recoveredPhone), false);

await db.close();
console.log('Device rules: USB identity, account and shop isolation, activation, policy delivery, and permanent and timed requests passed.');
