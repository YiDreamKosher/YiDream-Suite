import test from 'node:test';
import assert from 'node:assert/strict';
import { managedChromeControl, normalizeRuleTarget, normalizeSiteExpiry, deviceSections, mountDeviceControls } from '../src/device-controls.js';
import { YiDreamAdb } from '../src/adb.js';
import { enrollmentProgress } from '../src/device-enrollment.js';

test('activation confirmation matches the issued attempt and a subsequent phone sync', () => {
  const attempt = { id: 'current-attempt' };
  const oldSync = '2026-11-12T10:00:00Z';
  assert.equal(enrollmentProgress({ pending_activation_id: attempt.id, last_sync_at: oldSync }, attempt), 'enrollmentWaiting');
  assert.equal(enrollmentProgress({ redeemed_activation_id: 'other', last_sync_at: oldSync }, attempt), 'enrollmentReplaced');
  assert.equal(enrollmentProgress({ redeemed_activation_id: attempt.id, last_sync_at: null }, attempt), 'enrollmentRedeemed');
  assert.equal(enrollmentProgress({ redeemed_activation_id: attempt.id, last_sync_at: oldSync }, attempt), 'enrollmentSynced');
});

test('site rules are canonical domains and reject ambiguous or unsafe URLs', () => {
  assert.equal(normalizeRuleTarget('site', 'https://Example.Org./some/path'), 'example.org');
  assert.equal(normalizeRuleTarget('site', 'example.org'), 'example.org');
  for (const target of [
    'https://example.org@evil.org', 'https://example.org:8080', 'http://example.org',
    'file:///example.org', '127.0.0.1', '[::1]', '*.example.org',
    'https://example.org\\@evil.org', '/example.org'
  ]) assert.equal(normalizeRuleTarget('site', target), null, target);
  assert.equal(normalizeRuleTarget('app', 'com.example.app'), 'com.example.app');
  assert.equal(normalizeRuleTarget('app', 'com.example.app; echo foo'), null);
});

test('temporary site expiry converts the browser time and rejects invalid windows', () => {
  const now = new Date(2026, 10, 12, 8).getTime();
  assert.equal(normalizeSiteExpiry('2026-11-13T08:00', now), new Date(2026, 10, 13, 8).toISOString());
  for (const value of ['', '2026-11-12T08:00', '2026-12-32T08:00', '2027-02-30T08:00', '2027-11-13T08:00', '2026-11-13T08:00Z']) {
    assert.equal(normalizeSiteExpiry(value, now), null, value);
  }
});

test('managed Chrome requires a compatible report and confirms the current revision only', () => {
  const revision = 4;
  const view = (enabled, status, reported_revision) =>
    managedChromeControl({ revision, applied_revision: revision, managed_chrome: { enabled, status, reported_revision } });
  assert.deepEqual(managedChromeControl({ revision }), { status: 'serviceMissing', toggle: null });
  assert.deepEqual(view(false, null, null), { status: 'chromeUnreported', toggle: null });
  assert.deepEqual(view(false, 'unsupported', 4), { status: 'chromeUnsupported', toggle: null });
  assert.deepEqual(view(false, 'ready', 4), { status: 'chromeOff', toggle: true });
  assert.deepEqual(view(true, 'active', 3), { status: 'chromePending', toggle: false });
  assert.deepEqual(view(true, 'active', 4), { status: 'chromeActive', toggle: false });
  assert.deepEqual(view(true, 'failed', 4), { status: 'chromeFailed', toggle: false });
  assert.deepEqual(view(false, 'active', 3), { status: 'chromePending', toggle: true });
  for (const policy of [{ device_profile: 'mp3' }, { web_enabled: false },
    { device_profile: 'mp3', web_enabled: 'true' }]) {
    assert.deepEqual(managedChromeControl({ revision, ...policy,
      managed_chrome: { enabled: true, status: 'active', reported_revision: revision }
    }), { status: 'webSectionDisabled', toggle: null });
  }
  assert.deepEqual(managedChromeControl({ revision, device_profile: 'mp3', web_enabled: true,
    managed_chrome: { enabled: false, status: 'ready', reported_revision: revision }
  }), { status: 'chromeOff', toggle: true });
});

test('device manager markup keeps one rule editor and independent unnested forms', () => {
  const stopAfterMarkup = new Error('markup-captured');
  const host = { innerHTML: '', querySelector() { throw stopAfterMarkup; } };
  assert.throws(() => mountDeviceControls(host, {
    device: { id: 'device-a', user_id: 'shop-a', platform: 'Android', configuration_status: 'configured' },
    clients: [], language: 'fr', packages: [['Chrome', 'com.android.chrome'], ['Reader', 'com.example.reader']], api: {}
  }), error => error === stopAfterMarkup);
  for (const attribute of ['data-rule-form', 'data-rule-list', 'data-device-settings', 'data-client-form', 'data-managed-chrome']) {
    assert.equal((host.innerHTML.match(new RegExp('\\b' + attribute + '(?=[\\s>])', 'g')) || []).length, 1, attribute);
  }
  let formOpen = false;
  for (const tag of host.innerHTML.match(/<\/?form\b[^>]*>/g) || []) {
    if (tag.startsWith('</')) {
      assert.equal(formOpen, true, 'Every form end has a matching start');
      formOpen = false;
    } else {
      assert.equal(formOpen, false, 'A form never contains another form');
      formOpen = true;
    }
  }
  assert.equal(formOpen, false);
  assert.match(host.innerHTML, /<option value="com\.example\.reader"/);
  assert.doesNotMatch(host.innerHTML, /<option value="com\.android\.chrome"/);
});

const activationCode = 'AC'.repeat(16);

function usbFixture() {
  const usb = Object.create(YiDreamAdb.prototype);
  usb.info = { serial: 'phone-a' };
  usb.adb = {};
  return usb;
}

test('USB activation targets only the prepared phone and protected activity', async () => {
  const usb = usbFixture();
  let args;
  usb.sh = async command => { args = command; return { exitCode: 0, out: 'Status: ok' }; };
  await assert.rejects(usb.sendActivationCode(activationCode, 'phone-b'), /NOT_CONNECTED/);
  await assert.rejects(usb.sendActivationCode('invalid; echo foo', 'phone-a'), /INVALID_ACCOUNT_CODE/);
  assert.equal(args, undefined);
  await usb.sendActivationCode(activationCode, 'phone-a');
  assert.deepEqual(args, [
    'am', 'start', '-W', '-n', 'com.yidream.mdm/.UsbActivationActivity',
    '--es', 'yidream_activation_code', activationCode
  ]);
});

test('USB errors do not disclose activation codes and replaced connections fail', async () => {
  const usb = usbFixture();
  usb.sh = async () => { throw new Error('ADB failed: ' + activationCode); };
  await assert.rejects(usb.sendActivationCode(activationCode, 'phone-a'), { message: 'ACTIVATION_USB_FAILED' });
  usb.sh = async () => {
    usb.adb = {};
    return { exitCode: 0, out: 'Status: ok' };
  };
  await assert.rejects(usb.sendActivationCode(activationCode, 'phone-a'), /NOT_CONNECTED/);
});


test('MP3 sections inherit closed defaults and accept only explicit boolean exceptions', () => {
  assert.deepEqual(deviceSections({device_profile:'mp3'}), {webEnabled:false,appStoreEnabled:false});
  assert.deepEqual(deviceSections({device_profile:'qin'}), {webEnabled:true,appStoreEnabled:true});
  assert.deepEqual(deviceSections({}), {webEnabled:true,appStoreEnabled:true});
  assert.deepEqual(deviceSections({device_profile:'mp3',web_enabled:true,app_store_enabled:false}), {webEnabled:true,appStoreEnabled:false});
  assert.deepEqual(deviceSections({device_profile:'mp3',web_enabled:'true',app_store_enabled:1}), {webEnabled:false,appStoreEnabled:false});
  assert.deepEqual(deviceSections({device_profile:'qin',web_enabled:false,app_store_enabled:false}), {webEnabled:false,appStoreEnabled:false});
});
