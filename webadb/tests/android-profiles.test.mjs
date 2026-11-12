import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YiDreamAdb } from '../src/adb.js';
import { CONFIG } from '../src/config.js';
import { phoneProfileConfiguration } from '../src/android-setup.js';
import { ANDROID_PROFILES, MAX_PROFILE_PACKAGES, profileAllowList, profileApps } from '../src/android-profiles.js';

const mp3Apps = [
  'com.android.calculator2', 'com.android.deskclock', 'com.android.calendar', 'com.android.soundrecorder',
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
  assert.equal(apps.find(app => app.name === 'notes').packageName, null);
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
