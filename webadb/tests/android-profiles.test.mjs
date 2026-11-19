import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YiDreamAdb } from '../src/adb.js';
import { CONFIG } from '../src/config.js';
import { phoneProfileConfiguration } from '../src/android-setup.js';
import { ANDROID_PROFILES, MAX_PROFILE_PACKAGES, profileAllowList, profileApps, profileManagedPackages, isProfileProtected } from '../src/android-profiles.js';

const mp3Apps = [
  'com.android.calculator2', 'com.google.android.calculator', 'com.android.deskclock', 'com.google.android.deskclock',
  'com.android.calendar', 'com.google.android.calendar', 'com.android.soundrecorder', 'com.google.android.apps.recorder',
  'com.android.notes', 'com.android.notepad', 'com.google.android.keep',
  'com.jtech.zemer', 'tfilon.tfilon', 'net.calj.android', 'com.rhmsoft.pulsar', 'fm.jewishmusic.application'
];
const requestId = 'a5d058ac-a16f-4e9d-af54-9a7204923695';

test('MP3 and Qin share the base apps, and only Qin adds Waze and Kosher Scan by default', () => {
  assert.deepEqual(ANDROID_PROFILES, { mp3: 'MP3', qin: 'Qin' });
  assert.deepEqual(profileAllowList('mp3', null, ''), mp3Apps);
  assert.deepEqual(profileAllowList('qin', null, ''), [...mp3Apps, 'com.waze', 'app.kosherscan.kosher_scan']);
  assert.throws(() => profileAllowList('qin-plus', null, ''), /PROFILE_REQUIRED/);
});

test('verified firmware packages stay authorized when detection is unavailable, with exact manual variants supported', () => {
  const installed = new Set(['com.android.calculator2', 'com.android.deskclock.fake', 'com.vendor.notes']);
  const apps = profileApps('mp3');
  assert.equal(apps.find(app => app.name === 'calculator').packageName, 'com.android.calculator2');
  assert.deepEqual(apps.find(app => app.name === 'notes').packageNames,
    ['com.android.notes', 'com.android.notepad', 'com.google.android.keep']);
  assert.deepEqual(profileAllowList('mp3', installed, ' com.vendor.notes, com.jtech.zemer '),
    [...mp3Apps, 'com.vendor.notes']);
});

test('only official Play links matching installed packages become extra allowances', () => {
  const link = 'https://play.google.com/store/apps/details?id=com.vendor.notes';
  const installed = new Set(['com.vendor.notes']);
  assert.deepEqual(profileAllowList('mp3', installed, link), [...mp3Apps, 'com.vendor.notes']);
  assert.throws(() => profileAllowList('mp3', null, link), /PROFILE_PLAY_APP_NOT_INSTALLED/);
  assert.throws(() => profileAllowList('mp3', installed, link.replace('play.google.com', 'other.example')), /PROFILE_INVALID_PACKAGE/);
});

test('profile configuration authorizes only exact packages and rejects stores and oversized allow-lists', () => {
  const material = { intermediate_key: 'a'.repeat(64) };
  assert.deepEqual(phoneProfileConfiguration('mp3', new Set(), '', material, requestId), {
    block_browsers: false, block_ai: false, block_social: false, block_store: false, extra_packages: [],
    unlock_intermediate_key: material.intermediate_key, app_profile: 'mp3', profile_request_id: requestId,
    allowed_packages: mp3Apps
  });
  assert.throws(() => phoneProfileConfiguration('mp3', null, 'com.android.vending', material), /PROFILE_STORE_BLOCKED/);
  assert.throws(() => phoneProfileConfiguration('mp3', null, 'com.example.*', material), /PROFILE_INVALID_PACKAGE/);
  assert.throws(() => phoneProfileConfiguration('mp3', null, 'com.5example.app', material), /PROFILE_INVALID_PACKAGE/);
  const manyApps = Array.from({ length: MAX_PROFILE_PACKAGES }, (_, index) => 'com.example.app' + index).join(',');
  assert.throws(() => phoneProfileConfiguration('mp3', null, manyApps, material), /PROFILE_PACKAGE_LIMIT/);
});

test('ADB inventory reads exact package IDs and rejects a replaced connection', async () => {
  const usb = Object.create(YiDreamAdb.prototype);
  usb.info = { serial: 'phone-a' };
  usb.adb = {};
  usb.sh = async command => {
    assert.deepEqual(command, ['pm', 'list', 'packages', '--user', '0']);
    return { exitCode: 0, out: 'package:com.example.app\r\npackage:com.android.calendar\npackage:bad value\n' };
  };
  assert.deepEqual(await usb.listInstalledPackages('phone-a'), new Set(['com.example.app', 'com.android.calendar']));
  await assert.rejects(usb.listInstalledPackages('phone-b'), /NOT_CONNECTED/);
  usb.sh = async () => {
    usb.adb = {};
    return { exitCode: 0, out: 'package:com.example.app' };
  };
  await assert.rejects(usb.listInstalledPackages('phone-a'), /NOT_CONNECTED/);
  usb.sh = async () => ({ exitCode: null, out: 'Unknown option: --user' });
  await assert.rejects(usb.listInstalledPackages('phone-a'), /PROFILE_INVENTORY_FAILED/);
});

test('profile confirmation waits for the exact nonce on the same connected device', async () => {
  const usb = Object.create(YiDreamAdb.prototype);
  usb.info = { serial: 'phone-a' };
  usb.adb = {};
  const replies = [
    { exitCode: 1, out: 'No such file or directory' },
    { exitCode: 0, out: JSON.stringify({ profile_request_id: 'previous-request' }) },
    { exitCode: 0, out: JSON.stringify({ profile_request_id: requestId }) }
  ];
  usb.sh = async command => {
    assert.deepEqual(command, ['cat', CONFIG.profileReceiptRemotePath]);
    return replies.shift();
  };
  await usb.confirmConfiguration('phone-a', requestId);
  assert.equal(replies.length, 0);
  usb.sh = async () => {
    usb.adb = {};
    return { exitCode: 0, out: JSON.stringify({ profile_request_id: requestId }) };
  };
  await assert.rejects(usb.confirmConfiguration('phone-a', requestId), /NOT_CONNECTED/);
});


test('an unchecked base utility stays out of the phone allowance but remains managed remotely', () => {
  const clock = profileApps('mp3').find(app => app.name === 'clock').packageNames;
  const selected = mp3Apps.filter(name => !clock.includes(name));
  const allowed = profileAllowList('mp3', null, 'com.vendor.notes', selected);
  assert.deepEqual(allowed, [...selected, 'com.vendor.notes']);
  assert.ok(clock.every(name => !allowed.includes(name)));
  const managed = profileManagedPackages('mp3', allowed);
  assert.ok(clock.every(name => managed.includes(name)));
  assert.ok(managed.includes('com.waze'));
  assert.ok(managed.includes('app.kosherscan.kosher_scan'));
  assert.ok(managed.includes('com.vendor.notes'));
  assert.throws(() => profileAllowList('mp3', null, '', ['com.example.arbitrary']), /PROFILE_INVALID_PACKAGE/);
  assert.throws(() => profileAllowList('mp3', null, '', 'com.android.deskclock'), /PROFILE_INVALID_PACKAGE/);
});

test('selected packages use the same version 26 phone payload and exact receipt contract', () => {
  const selected = mp3Apps.filter(name => name !== 'com.jtech.zemer');
  const config = phoneProfileConfiguration('mp3', null, '', { intermediate_key: 'a'.repeat(64) }, requestId, selected);
  assert.equal(config.profile_request_id, requestId);
  assert.equal(config.app_profile, 'mp3');
  assert.deepEqual(config.allowed_packages, selected);
  assert.deepEqual(config.extra_packages, []);
});


test('protected Android services and the reserved browser cannot be selected as extra apps', () => {
  for (const pkg of ['com.yidream.mdm', 'com.android.settings', 'com.android.packageinstaller',
    'com.android.webview', 'com.android.chrome']) {
    assert.equal(isProfileProtected(pkg), true);
    assert.throws(() => profileAllowList('mp3', new Set([pkg]), pkg), /PROFILE_PROTECTED_PACKAGE/);
  }
  assert.equal(isProfileProtected('com.vendor.notes'), false);
});
