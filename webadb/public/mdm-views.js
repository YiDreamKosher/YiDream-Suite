export const VIEWS = Object.freeze({home:'Accueil',catalog:'Boutique d’applications',requests:'Demandes d’accès',pair:'Associer un appareil'});
const legacy = Object.freeze({'#homePanel':'home','#catalogPanel':'catalog','#catalogForm':'catalog','#requestsPanel':'requests','#pairPanel':'pair'});
export function resolveView(search, hash) {
  const query = new URLSearchParams(search).get('view');
  const candidate = legacy[hash] || (/^#mdm-(home|catalog|requests|pair)$/.exec(hash || '')?.[1]) || query;
  return Object.hasOwn(VIEWS, candidate) ? candidate : 'home';
}
export function mayImport(user, owner) { return !!user?.id && owner === true; }
