import test from 'node:test';
import assert from 'node:assert/strict';
import { registerPreparedUsbPhone, prepareProfiledUsbPhone } from '../src/usb-profile-policy.js';

const id = 'a5d058ac-a16f-4e9d-af54-9a7204923695';
const other = 'a5d058ac-a16f-4e9d-af54-9a7204923696';
const phone = { serial: 'local-fixture-phone' };
const configuration = { app_profile: 'mp3', allowed_packages: ['com.jtech.zemer', 'com.vendor.notes'] };

function fixture() {
  const calls = [];
  const api = {
    async registerUsbDevice(...args) { calls.push(['register', ...args]); return { device_id: id, configuration_status: 'pending' }; },
    async saveUsbAppProfile(...args) { calls.push(['profile', ...args]); return {}; },
    async setDeviceConfigured() { throw new Error('Must not approve a device'); },
    async issueDeviceActivation() { throw new Error('Must not activate an account'); }
  };
  return { api, calls };
}

test('pending-device preparation saves exact selections and unchecked baseline packages before returning', async () => {
  const { api, calls } = fixture();
  const record = await registerPreparedUsbPhone(api, phone, null, configuration);
  assert.equal(record.configuration_status, 'pending');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ['register', phone, null]);
  assert.deepEqual(calls[1].slice(0, 4), ['profile', id, 'mp3', configuration.allowed_packages]);
  const managed = calls[1][4];
  assert.ok(managed.includes('com.android.deskclock'));
  assert.ok(managed.includes('com.waze'));
  assert.ok(managed.includes('com.vendor.notes'));
  assert.ok(!configuration.allowed_packages.includes('com.android.deskclock'));
});

test('a changed target or disposed workspace cannot receive profile rules', async () => {
  const wrong = fixture();
  await assert.rejects(registerPreparedUsbPhone(wrong.api, phone, other, configuration), /USB_DEVICE_MISMATCH/);
  assert.equal(wrong.calls.length, 1);
  const closed = fixture();
  let checks = 0;
  await assert.rejects(registerPreparedUsbPhone(closed.api, phone, null, configuration, () => {
    if (++checks === 2) throw new Error('NOT_CONNECTED');
  }), /NOT_CONNECTED/);
  assert.equal(closed.calls.length, 1);
});

test('policy denial stays a failure and cannot fall through into approval or activation', async () => {
  const { api, calls } = fixture();
  api.saveUsbAppProfile = async () => { throw new Error('USB_PROFILE_APP_DENIED'); };
  await assert.rejects(registerPreparedUsbPhone(api, phone, id, configuration), /USB_PROFILE_APP_DENIED/);
  assert.deepEqual(calls.map(call => call[0]), ['register']);
  const invalid = fixture();
  await assert.rejects(registerPreparedUsbPhone(invalid.api, phone, null, { app_profile: 'other' }), /PROFILE_REQUIRED/);
  assert.equal(invalid.calls.length, 0);
});


function preparationFixture() {
  const events = [];
  let owns = false;
  const client = {
    info: phone,
    async installApk() { events.push('install'); },
    async isInstalled() { return true; },
    async sh() { return { out: `Device Owner:\n admin=ComponentInfo{${owns ? 'com.yidream.mdm/.Admin' : 'other.app/.Admin'}}\n User ID: 0` }; },
    async setDeviceOwner() { events.push('owner'); owns = true; return { exitCode: 0 }; },
    async applyConfig(config) { events.push('apply'); assert.equal(config.profile_request_id, id); },
    async confirmConfiguration(serial, nonce) { events.push('receipt'); assert.equal(serial, phone.serial); assert.equal(nonce, id); }
  };
  const api = {
    async registerUsbDevice() { events.push('register'); return { device_id: id, configuration_status: 'pending' }; },
    async saveUsbAppProfile() { events.push('policy'); },
    async setDeviceConfigured() { throw new Error('Must not approve'); }
  };
  return { client, api, events, config: { ...configuration, profile_request_id: id } };
}

test('server validation precedes phone changes and only an exact applied receipt completes preparation', async () => {
  const f = preparationFixture();
  const record = await prepareProfiledUsbPhone(f.client, { blob: new Blob(['fixture']) }, f.config, f.api, null);
  assert.equal(record.configuration_status, 'pending');
  assert.deepEqual(f.events, ['register', 'policy', 'install', 'owner', 'apply', 'receipt']);
});

test('a fresh server denial or connection change prevents every phone mutation', async () => {
  const denied = preparationFixture();
  denied.api.saveUsbAppProfile = async () => { denied.events.push('policy-denied'); throw new Error('USB_PROFILE_APP_DENIED'); };
  await assert.rejects(prepareProfiledUsbPhone(denied.client, {}, denied.config, denied.api, id), /USB_PROFILE_APP_DENIED/);
  assert.deepEqual(denied.events, ['register', 'policy-denied']);
  const changed = preparationFixture();
  changed.api.saveUsbAppProfile = async () => { changed.events.push('policy'); changed.client.info = { serial: 'another-phone' }; };
  await assert.rejects(prepareProfiledUsbPhone(changed.client, {}, changed.config, changed.api, id), /NOT_CONNECTED/);
  assert.deepEqual(changed.events, ['register', 'policy']);
});

test('missing phone acknowledgement never returns an enrollment-ready record', async () => {
  const f = preparationFixture();
  f.client.confirmConfiguration = async () => { f.events.push('failed-receipt'); throw new Error('CONFIGURATION_NOT_CONFIRMED'); };
  await assert.rejects(prepareProfiledUsbPhone(f.client, { blob: new Blob(['fixture']) }, f.config, f.api, null), /CONFIGURATION_NOT_CONFIRMED/);
  assert.deepEqual(f.events, ['register', 'policy', 'install', 'owner', 'apply', 'failed-receipt']);
});
