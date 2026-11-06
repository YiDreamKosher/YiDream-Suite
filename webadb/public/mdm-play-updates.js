import { parsePlayUrl } from './mdm-model.js';

/** A Play listing is metadata, never evidence that a compatible APK is ready. */
export function playSource(app) {
  const value = app.source_url;
  if (typeof value !== 'string' || !value) throw Error('Aucune fiche Google Play associée.');
  const url = new URL(value);
  // Reject explicit ports (including :443, which URL normalizes away), credentials,
  // fragments and duplicate package parameters before creating the fixed gateway path.
  if (!/^https:\/\/play\.google\.com\//.test(value) || url.hash ||
      url.port || url.username || url.password || url.searchParams.getAll('id').length !== 1 ||
      parsePlayUrl(value) !== app.package_name) {
    throw Error('La fiche Google Play ne correspond pas au paquet de cette application.');
  }
  return 'https://play.google.com/store/apps/details?id=' + encodeURIComponent(app.package_name);
}

export function strictVersionCode(value) {
  if (typeof value === 'string' && !/^[1-9]\d*$/.test(value)) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const code = Number(value);
  return Number.isSafeInteger(code) && code > 0 ? code : null;
}

export function comparePlayRelease(app, info) {
  if (!info || typeof info !== 'object' || Array.isArray(info) || info.error) {
    throw Error(typeof info?.error === 'string' ? info.error : 'Fiche Google Play illisible.');
  }
  for (const key of ['package_name', 'packageName', 'appId']) {
    if (info[key] != null && info[key] !== app.package_name) {
      throw Error('Le fournisseur a renvoyé la fiche d’une autre application.');
    }
  }
  const candidates = [info.versionCode, info.version_code].filter(value => value != null);
  const codes = candidates.map(strictVersionCode);
  const code = codes.length && codes.every(value => value != null && value === codes[0]) ? codes[0] : null;
  const publishedCode = strictVersionCode(app.version_code);
  const name = [info.versionName, info.version_name, info.version].find(value => typeof value === 'string' && value.length <= 100) || '';
  const kind = code == null ? 'unconfirmed' : publishedCode == null ? 'prepare' :
    code > publishedCode ? 'update' : code === publishedCode ? 'current' : 'older';
  return {kind, code, publishedCode, name, canPrepare: ['update', 'prepare', 'unconfirmed'].includes(kind)};
}

/** Check in order so a failed provider response cannot discard the other results. */
export async function checkPlayCatalog(apps, fetchInfo, onResult, active = () => true) {
  for (const app of apps) {
    if (!active()) break;
    let result;
    if (app.source_url == null || (typeof app.source_url === 'string' && !app.source_url.trim())) {
      onResult(app, {kind: 'skipped', message: 'Aucune fiche Google Play associée. Cette application reste gérée par son fichier APK habituel.', canPrepare: false});
      continue;
    }
    try {
      const source = playSource(app);
      const info = await fetchInfo(app);
      result = {...comparePlayRelease(app, info), source};
    } catch (error) {
      result = {kind: 'error', message: error?.message || 'Vérification impossible.', canPrepare: false};
    }
    if (!active()) break;
    onResult(app, result);
  }
}
