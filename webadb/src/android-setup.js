import { CONFIG } from './config.js';
import { parseExtraPackages } from './adb.js';

/** Keep the phone's own preparation separate from the saved fleet record. */
export async function preparePhone(client, release, report = () => {}) {
  const serial = client.info?.serial;
  if (!serial) throw new Error('NOT_CONNECTED');
  const connected = () => {
    if (client.info?.serial !== serial) throw new Error('NOT_CONNECTED');
  };
  report('install');
  connected();
  await client.installApk(release.blob);
  connected();
  if (!await client.isInstalled()) throw new Error('Installation YiDream non confirmée. Réessayez.');
  report('owner');
  connected();
  const policy = await client.sh(['dumpsys', 'device_policy']);
  const ownerSection = policy.out.match(/Device Owner:[\s\S]*?(?=\n\s*(?:Profile Owner|User ID|Enabled Device Admins)|$)/)?.[0] || '';
  if (!ownerSection.includes('admin=ComponentInfo{' + CONFIG.appPackage + '/')) {
    const result = await client.setDeviceOwner();
    connected();
    if (!(result.exitCode === 0 || (result.exitCode === null && /Success/i.test(result.out)))) {
      throw new Error(result.out || 'La gestion du téléphone n’a pas pu être activée.');
    }
  }
  connected();
  return serial;
}

export function phoneConfiguration(packages, extraText, material) {
  const extra = parseExtraPackages(extraText);
  if (extra.invalid.length) throw new Error('Identifiants Android invalides : ' + extra.invalid.join(', '));
  if (!material?.intermediate_key) throw new Error('Le code sécurisé n’a pas pu être chargé.');
  return {
    block_browsers: false, block_ai: false, block_social: false, block_store: false,
    extra_packages: [...new Set([...packages, ...extra.valid])],
    unlock_intermediate_key: material.intermediate_key
  };
}
