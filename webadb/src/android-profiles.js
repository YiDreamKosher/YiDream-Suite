import { parseExtraPackages } from './adb.js';
import { parsePlayUrl } from '../public/mdm-model.js';

export const PROFILE_VERSION_CODE = 23;
export const MAX_PROFILE_PACKAGES = 100;

export const ANDROID_PROFILES = Object.freeze({ mp3: 'MP3', qin: 'Qin' });

const packageId = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

const builtIns = [
  ['calculator', 'com.android.calculator2'],
  ['clock', 'com.android.deskclock'],
  ['calendar', 'com.android.calendar'],
  ['recorder', 'com.android.soundrecorder'],
  ['notes', null]
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

export function isProfileStore(packageName) {
  return stores.has(packageName);
}

export function profileApps(profile) {
  if (!Object.hasOwn(ANDROID_PROFILES, profile)) throw new Error('PROFILE_REQUIRED');
  return [
    ...builtIns.map(([name, packageName]) => ({
      name, packageName, builtIn: true
    })),
    ...baseApps.concat(profile === 'qin' ? qinApps : []).map(([name, packageName]) => ({
      name, packageName, builtIn: false
    }))
  ];
}

export function profileAllowList(profile, installed, extraText) {
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
  const { valid, invalid } = parseExtraPackages(extras.join(','));
  if (invalid.length || valid.some(packageName => packageName.length > 255 || !packageId.test(packageName))) throw new Error('PROFILE_INVALID_PACKAGE');
  if (valid.some(isProfileStore)) throw new Error('PROFILE_STORE_BLOCKED');
  const packages = [...new Set([
    ...profileApps(profile).map(app => app.packageName).filter(Boolean),
    ...valid
  ])];
  if (packages.length > MAX_PROFILE_PACKAGES) throw new Error('PROFILE_PACKAGE_LIMIT');
  return packages;
}
