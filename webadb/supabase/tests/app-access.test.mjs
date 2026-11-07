import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite(); await db.waitReady;
const ids = {
 adminA:'00000000-0000-4000-8000-000000000001',adminB:'00000000-0000-4000-8000-000000000002',owner:'00000000-0000-4000-8000-000000000003',
 userA:'00000000-0000-4000-8000-000000000004',userB:'00000000-0000-4000-8000-000000000005',unverified:'00000000-0000-4000-8000-000000000006',
 deviceA:'10000000-0000-4000-8000-000000000001',deviceB:'10000000-0000-4000-8000-000000000002',unconfigured:'10000000-0000-4000-8000-000000000003',
};
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema storage; create schema extensions;
-- PGlite has no pgcrypto extension. This test-only stand-in exercises its bytea API/length.
create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile as $$select substring(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')) from 1 for n)$$;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create table public.platform_admins(user_id uuid primary key references auth.users,role text,is_active boolean default true);
create function public.is_platform_owner() returns boolean language sql stable security definer as $$select exists(select 1 from public.platform_admins where user_id=auth.uid() and role='owner' and is_active)$$;
create function public.is_platform_admin() returns boolean language sql stable security definer as $$select exists(select 1 from public.platform_admins where user_id=auth.uid() and role in ('owner','admin') and is_active)$$;
create table public.devices(id uuid primary key,user_id uuid references auth.users,name text,configuration_status text default 'configured',created_at timestamptz default now());
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update on storage.objects to anon,authenticated;
insert into auth.users values
('${ids.adminA}','admina@example.com',now(),null),('${ids.adminB}','adminb@example.com',now(),null),('${ids.owner}','owner@example.com',now(),null),
('${ids.userA}','usera@example.com',now(),null),('${ids.userB}','userb@example.com',now(),null),('${ids.unverified}','unverified@example.com',null,null);
insert into auth.sessions select id,id,null from auth.users;
insert into public.platform_admins values('${ids.adminA}','admin',true),('${ids.adminB}','admin',true),('${ids.owner}','owner',true);
insert into public.devices values('${ids.deviceA}','${ids.adminA}','Phone A','configured',now()),('${ids.deviceB}','${ids.adminB}','Phone B','configured',now()),('${ids.unconfigured}','${ids.adminA}','Not prepared','needs_configuration',now());
`);
for (const file of ['20261029000000_mdm_catalog_and_site_requests.sql','20261030000000_catalog_releases_and_revocation.sql']) {
 await db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
}
const migration = await readFile(new URL('../migrations/20261106135728_app_customer_access.sql',import.meta.url),'utf8');
await db.exec(`insert into public.yd_device_links(device_id,token_hash,pairing_hash,pairing_expires_at) values('${ids.deviceA}',public.yd_token_hash('legacy-device-token'),public.yd_token_hash('LEGACY'),now()+interval '15 minutes')`);
await db.exec(migration); await db.exec(migration);
const act = async(role,id='') => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(id?{sub:id,session_id:id}:{})]); await db.query("select set_config('request.headers','{}',false)"); await db.exec('set role '+role); };
const scalar = async(sql,params=[]) => Object.values((await db.query(sql,params)).rows[0])[0];
const headers = async(value) => db.query("select set_config('request.headers',$1,false)",[JSON.stringify(value)]);
const issue = async(admin,device) => { await act('authenticated',admin); return scalar('select public.yd_create_pairing($1)',[device]); };
const activate = async(code,email='usera@example.com',phone='+33766790352') => { await act('anon'); return scalar('select public.yd_activate_app_code($1,$2,$3)',[code,email,phone]); };

await act('anon');
await assert.rejects(()=>db.query('select * from public.yd_app_accounts'));
await assert.rejects(()=>db.query('select public.yd_complete_app_profile($1)',['+33766790352']));
await assert.rejects(()=>db.query('select public.yd_claim_app_auth_email($1,$2)',['a'.repeat(64),'b'.repeat(64)]));
await assert.rejects(()=>db.query('select public.yd_app_access_status(null)'));
await assert.rejects(()=>db.query('select * from public.yd_device_catalog($1)',['legacy-device-token']));
await act('authenticated',ids.unverified);
await assert.rejects(()=>db.query('select public.yd_complete_app_profile($1)',['+33766790352']));
await act('authenticated',ids.userA);
await assert.rejects(()=>db.query('select public.yd_complete_app_profile($1)',['phone']));
const profile = await scalar('select public.yd_complete_app_profile($1)',['+33766790352']);
assert.equal(profile.account.email,'usera@example.com'); assert.equal(profile.account.email_verified,true); assert.equal(profile.device_id,null);
await assert.rejects(()=>db.query("update public.yd_app_accounts set is_active=true"));
await assert.rejects(()=>db.query('select public.yd_list_app_accounts()'));
await act('authenticated',ids.userB); assert.equal((await db.query('select * from public.yd_app_accounts')).rows.length,0);
await act('authenticated',ids.adminA);
await assert.rejects(()=>db.query('select public.yd_create_pairing($1)',[ids.deviceB]));
await assert.rejects(()=>db.query('select public.yd_create_pairing($1)',[ids.unconfigured]));
const codeA = await issue(ids.adminA,ids.deviceA); assert.match(codeA,/^[0-9A-F]{32}$/);
await act('anon');
await assert.rejects(()=>db.query('select public.yd_pair_device($1)',[codeA]));
await assert.rejects(()=>db.query('select public.yd_activate_app_code($1,$2,$3)',[codeA,'bad-email','+33766790352']));
await assert.rejects(()=>db.query('select public.yd_activate_app_code($1,$2,$3)',[codeA,'usera@example.com','0766790352']));
const codeSession = await activate(codeA);
assert.equal(codeSession.account.email_verified,false); assert.notEqual(codeSession.account.id,profile.account.id);
assert.match(codeSession.token,/^[0-9a-f]{64}$/); assert.match(codeSession.app_token,/^[0-9a-f]{64}$/);
assert.ok(Date.parse(codeSession.expires_at)>Date.now()+29*86400000);
await assert.rejects(()=>db.query('select public.yd_activate_app_code($1,$2,$3)',[codeA,'usera@example.com','+33766790352']));
const status = await scalar('select public.yd_app_access_status($1)',[codeSession.app_token]); assert.equal(status.device_id,ids.deviceA);
await assert.rejects(()=>db.query('select * from public.yd_device_catalog($1)',[codeSession.token]));
await headers({'x-yidream-app-token':'invalid'});
await assert.rejects(()=>db.query('select * from public.yd_device_catalog($1)',[codeSession.token]));
await headers({'x-yidream-app-token':codeSession.app_token});
assert.equal((await db.query('select * from public.yd_device_catalog($1)',[codeSession.token])).rows.length,5);
await db.query('select public.yd_request_site($1,$2,$3,$4)',[codeSession.token,'https://example.com/','Help','20000000-0000-4000-8000-000000000001']);
const codeB = await issue(ids.adminB,ids.deviceB); const sessionB = await activate(codeB,'other@example.com');
await headers({'x-yidream-app-token':codeSession.app_token});
await assert.rejects(()=>db.query('select * from public.yd_device_catalog($1)',[sessionB.token]));
await db.exec('reset role');
await db.query("update public.yd_catalog set storage_path=$1 where package_name='com.whatsapp'",[ids.owner+'/whatsapp.apk']);
await db.query("insert into storage.objects(bucket_id,name)values('yd-apks',$1)",[ids.owner+'/whatsapp.apk']);
await act('anon'); await headers({'x-yidream-device-token':codeSession.token});
assert.equal((await db.query('select * from storage.objects')).rows.length,0);
await headers({'x-yidream-device-token':codeSession.token,'x-yidream-app-token':sessionB.app_token});
assert.equal((await db.query('select * from storage.objects')).rows.length,0);
await headers({'x-yidream-device-token':codeSession.token,'x-yidream-app-token':codeSession.app_token});
assert.equal((await db.query('select * from storage.objects')).rows.length,1);
await db.exec('reset role'); await db.query('update public.devices set user_id=$1 where id=$2',[ids.adminB,ids.deviceA]);
await act('anon'); await assert.rejects(()=>db.query('select public.yd_app_access_status($1)',[codeSession.app_token]));
await headers({'x-yidream-device-token':codeSession.token,'x-yidream-app-token':codeSession.app_token});
assert.equal((await db.query('select * from storage.objects')).rows.length,0);
await db.exec('reset role'); await db.query('update public.devices set user_id=$1 where id=$2',[ids.adminA,ids.deviceA]);
await db.query("update public.devices set configuration_status='needs_configuration' where id=$1",[ids.deviceA]);
await act('anon'); await assert.rejects(()=>db.query('select public.yd_app_access_status($1)',[codeSession.app_token]));
await db.exec('reset role'); await db.query("update public.devices set configuration_status='configured' where id=$1",[ids.deviceA]);
await act('authenticated',ids.adminB);
await assert.rejects(()=>db.query('select public.yd_set_app_account_access($1,false)',[codeSession.account.id]));
assert.equal((await db.query('select * from public.yd_list_app_accounts()')).rows.length,1);
await act('authenticated',ids.adminA);
assert.equal((await db.query('select * from public.yd_list_app_accounts()')).rows[0].email_verified,false);
const beforeSuspension = await scalar('select public.yd_create_pairing($1)',[ids.deviceA]);
await db.query('select public.yd_set_app_account_access($1,false)',[codeSession.account.id]);
await assert.rejects(()=>activate(beforeSuspension));
await act('anon'); await assert.rejects(()=>db.query('select public.yd_app_access_status($1)',[codeSession.app_token]));
await act('authenticated',ids.adminA); await db.query('select public.yd_set_app_account_access($1,true)',[codeSession.account.id]);
await act('anon'); assert.equal((await scalar('select public.yd_app_access_status($1)',[codeSession.app_token])).account.id,codeSession.account.id);
await db.exec('reset role'); await db.query('update public.platform_admins set is_active=false where user_id=$1',[ids.adminA]);
await act('anon'); await assert.rejects(()=>db.query('select public.yd_app_access_status($1)',[codeSession.app_token]));
await headers({'x-yidream-app-token':codeSession.app_token}); await assert.rejects(()=>db.query('select * from public.yd_device_catalog($1)',[codeSession.token]));
await db.exec('reset role'); await db.query('update public.platform_admins set is_active=true where user_id=$1',[ids.adminA]);
await db.query("update public.yd_device_links set app_session_expires_at=now()-interval '1 minute' where device_id=$1",[ids.deviceA]);
await act('anon'); await assert.rejects(()=>db.query('select public.yd_app_access_status($1)',[codeSession.app_token]));

// Reissuing a code alone does not revoke a live phone; redemption rotates the old tokens.
await db.exec('reset role'); await db.query("update public.yd_device_links set app_session_expires_at=now()+interval '1 day' where device_id=$1",[ids.deviceA]);
const nextCode = await issue(ids.adminA,ids.deviceA);
await act('anon'); assert.equal((await scalar('select public.yd_app_access_status($1)',[codeSession.app_token])).device_id,ids.deviceA);
await act('authenticated',ids.userA); const paired = await scalar('select public.yd_pair_device($1)',[nextCode]);
assert.equal(paired.account.id,profile.account.id);
assert.equal((await db.query('select * from public.yd_device_catalog($1)',[paired.token])).rows.length,5);
await act('authenticated',ids.userB); await scalar('select public.yd_complete_app_profile($1)',['+33123456789']);
await assert.rejects(()=>db.query('select * from public.yd_device_catalog($1)',[paired.token]));
await act('anon'); await assert.rejects(()=>db.query('select public.yd_app_access_status($1)',[codeSession.app_token]));

// Email account spanning shops cannot be globally suspended by one ordinary shop admin.
const otherCode=await issue(ids.adminB,ids.deviceB); await act('authenticated',ids.userA); await scalar('select public.yd_pair_device($1)',[otherCode]);
await act('authenticated',ids.adminA); assert.equal((await db.query('select * from public.yd_list_app_accounts()')).rows[0].can_manage,false);
await assert.rejects(()=>db.query('select public.yd_set_app_account_access($1,false)',[profile.account.id]));
await act('authenticated',ids.owner); await db.query('select public.yd_set_app_account_access($1,false)',[profile.account.id]);
await act('authenticated',ids.userA); await assert.rejects(()=>db.query('select public.yd_app_access_status(null)'));
await assert.rejects(()=>db.query('select public.yd_complete_app_profile($1)',['+33123456789']));
await act('authenticated',ids.owner); await db.query('select public.yd_set_app_account_access($1,true)',[profile.account.id]);
// Logout removes the Auth session: an otherwise-valid, unexpired bearer cannot bypass it.
await db.exec('reset role'); await db.query('delete from auth.sessions where user_id=$1',[ids.userA]);
await act('authenticated',ids.userA); await assert.rejects(()=>db.query('select public.yd_app_access_status(null)'));
await assert.rejects(()=>db.query('select public.yd_complete_app_profile($1)',['+33123456789']));
await assert.rejects(()=>db.query('select * from public.yd_device_catalog($1)',[paired.token]));
await db.exec('reset role'); await db.query('insert into auth.sessions(id,user_id)values($1,$1)',[ids.userA]);

// Expired code, inactive issuer and wrong ownership never redeem. Existing policy stays intact.
const expired=await issue(ids.adminA,ids.deviceA); await db.exec('reset role'); await db.query("update public.yd_device_links set pairing_expires_at=now()-interval '1 minute' where device_id=$1",[ids.deviceA]);
await assert.rejects(()=>activate(expired));
const inactive=await issue(ids.adminA,ids.deviceA); await db.exec('reset role'); await db.query('update public.platform_admins set is_active=false where user_id=$1',[ids.adminA]);
await assert.rejects(()=>activate(inactive));
await db.exec('reset role'); await db.query('update public.platform_admins set is_active=true where user_id=$1',[ids.adminA]);
const logoutCode=await issue(ids.adminA,ids.deviceA); const logoutSession=await activate(logoutCode);
await db.query('select public.yd_logout_app_session($1)',[logoutSession.app_token]); await db.query('select public.yd_logout_app_session($1)',[logoutSession.app_token]);
await assert.rejects(()=>db.query('select public.yd_app_access_status($1)',[logoutSession.app_token]));

// Public mail function cannot reserve budget; concurrent quotas serialize inside the RPC.
await act('authenticated',ids.userA); await assert.rejects(()=>db.query('select public.yd_claim_app_auth_email($1,$2)',['a'.repeat(64),'b'.repeat(64)]));
await act('service_role');
assert.equal(await scalar('select public.yd_claim_app_auth_email($1,$2)',['a'.repeat(64),'b'.repeat(64)]),true);
assert.equal(await scalar('select public.yd_claim_app_auth_email($1,$2)',['a'.repeat(64),'c'.repeat(64)]),false);
await db.exec('reset role'); await db.exec("update private.yd_app_auth_budget set last_attempt_at=now()-interval '2 minutes' where scope='email'");
await act('service_role'); assert.equal(await scalar('select public.yd_claim_app_auth_email($1,$2)',['a'.repeat(64),'b'.repeat(64)]),true);
await db.exec('reset role'); await db.exec("update private.yd_app_auth_budget set attempts=15 where scope='ip'");
await act('service_role'); assert.equal(await scalar('select public.yd_claim_app_auth_email($1,$2)',['d'.repeat(64),'b'.repeat(64)]),false);
await db.exec('reset role'); await db.exec("update private.yd_app_auth_budget set attempts=5,last_attempt_at=now()-interval '2 minutes' where scope='email'");
await act('service_role'); assert.equal(await scalar('select public.yd_claim_app_auth_email($1,$2)',['a'.repeat(64),'f'.repeat(64)]),false);
await db.exec('reset role'); await db.exec("update private.yd_app_auth_budget set attempts=100 where scope='global'");
await act('service_role'); assert.equal(await scalar('select public.yd_claim_app_auth_email($1,$2)',['d'.repeat(64),'e'.repeat(64)]),false);
await db.exec('reset role'); await db.exec(migration);
assert.equal((await db.query('select count(*)::int n from public.platform_admins')).rows[0].n,3);
assert.equal((await db.query('select configuration_status from public.devices where id=$1',[ids.deviceA])).rows[0].configuration_status,'configured');
await db.close();
console.log('App access: confirmed email, required phone, isolated code accounts, replay/expiry, server-side device/storage gating, cross-shop isolation, suspension/restoration, logout and private mail budget checks passed.');
