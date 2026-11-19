import { parseExtraPackages } from './adb.js';
import { parsePlayUrl } from '../public/mdm-model.js';

export const PROFILE_VERSION_CODE = 26;
export const MAX_PROFILE_PACKAGES = 100;

export const ANDROID_PROFILES = Object.freeze({ mp3: 'MP3', qin: 'Qin' });

const packageId = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

const builtIns = [
  ['calculator', ['com.android.calculator2', 'com.google.android.calculator']],
  ['clock', ['com.android.deskclock', 'com.google.android.deskclock']],
  ['calendar', ['com.android.calendar', 'com.google.android.calendar']],
  ['recorder', ['com.android.soundrecorder', 'com.google.android.apps.recorder']],
  ['notes', ['com.android.notes', 'com.android.notepad', 'com.google.android.keep']]
];
const baseApps = [
  ['Zemer', 'com.jtech.zemer'],
  ['Tfilon', 'tfilon.tfilon'],
  ['CalJ', 'net.calj.android'],
  ['Pulsar', 'com.rhmsoft.pulsar'],
  ['Zing', 'fm.jewishmusic.application']
];
const qinApps = [
  ['Waze', 'com.waze'],
  ['Kosher Scan', 'app.kosherscan.kosher_scan']
];

const stores = new Set([
  'com.android.vending', 'com.amazon.venezia', 'com.sec.android.app.samsungapps', 'com.huawei.appmarket',
  'com.xiaomi.market', 'com.oppo.market', 'com.heytap.market', 'com.bbk.appstore', 'com.vivo.appstore',
  'org.fdroid.fdroid', 'com.aurora.store'
]);

const protectedPackages = new Set([
  ...stores, 'com.yidream.mdm', 'com.android.settings', 'com.android.systemui',
  'com.android.permissioncontroller', 'com.google.android.permissioncontroller',
  'com.android.packageinstaller', 'com.google.android.packageinstaller',
  'com.android.shell', 'com.android.phone', 'com.android.server.telecom',
  'com.android.providers.settings', 'com.android.providers.telephony',
  'com.android.webview', 'com.google.android.webview', 'com.android.chrome'
]);

export function isProfileProtected(packageName) { return protectedPackages.has(packageName); }

export function isProfileStore(packageName) {
  return stores.has(packageName);
}

export function profileApps(profile) {
  if (!Object.hasOwn(ANDROID_PROFILES, profile)) throw new Error('PROFILE_REQUIRED');
  return [
    ...builtIns.map(([name, packageNames]) => ({
      name, packageName: packageNames[0], packageNames, builtIn: true
    })),
    ...baseApps.concat(profile === 'qin' ? qinApps : []).map(([name, packageName]) => ({
      name, packageName, packageNames: [packageName], builtIn: false
    }))
  ];
}

export function profileManagedPackages(profile, selected = []) {
  profileApps(profile); // Validate before returning the baseline managed across profile changes.
  return [...new Set([...profileApps('qin').flatMap(app => app.packageNames), ...selected])];
}

export function profileAllowList(profile, installed, extraText, selected = null) {
  const extras = extraText.split(',').map(value => {
    const input = value.trim();
    if (!input.includes('://')) return input;
    let packageName;
    try {
      packageName = parsePlayUrl(input);
    } catch {
      throw new Error('PROFILE_INVALID_PACKAGE');
    }
    if (!installed?.has(packageName)) throw new Error('PROFILE_PLAY_APP_NOT_INSTALLED');
    return packageName;
  });
  const defaults = profileApps(profile).flatMap(app => app.packageNames);
  if (selected !== null && (!Array.isArray(selected) || selected.some(name => !defaults.includes(name)))) {
    throw new Error('PROFILE_INVALID_PACKAGE');
  }
  const { valid, invalid } = parseExtraPackages(extras.join(','));
  if (invalid.length || valid.some(packageName => packageName.length > 255 || !packageId.test(packageName))) throw new Error('PROFILE_INVALID_PACKAGE');
  if (valid.some(isProfileStore)) throw new Error('PROFILE_STORE_BLOCKED');
  if (valid.some(isProfileProtected)) throw new Error('PROFILE_PROTECTED_PACKAGE');
  const packages = [...new Set([
    ...(selected ?? defaults),
    ...valid
  ])];
  if (profileManagedPackages(profile, packages).length > MAX_PROFILE_PACKAGES) throw new Error('PROFILE_PACKAGE_LIMIT');
  return packages;
}
