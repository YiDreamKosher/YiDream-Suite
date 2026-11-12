export const BASE_APPS = [
 {name:'WhatsApp',package_name:'com.whatsapp',description:'Messagerie et appels.',source_url:'https://play.google.com/store/apps/details?id=com.whatsapp'},
 {name:'CalJ',package_name:'net.calj.android',description:'Calendrier juif, fêtes et horaires.',source_url:'https://play.google.com/store/apps/details?id=net.calj.android'},
 {name:'Tfilon',package_name:'tfilon.tfilon',description:'Siddour et prières au quotidien.',source_url:'https://play.google.com/store/apps/details?id=tfilon.tfilon'},
 {name:'Waze',package_name:'com.waze',description:'Navigation et itinéraires.',source_url:'https://play.google.com/store/apps/details?id=com.waze'},
 {name:'Kosher Scan',package_name:'app.kosherscan.kosher_scan',description:'Scanner et rechercher des produits casher.',source_url:'https://play.google.com/store/apps/details?id=app.kosherscan.kosher_scan'}
];
export function parsePlayUrl(value){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.hostname!=='play.google.com'||url.pathname!=='/store/apps/details')throw Error('Utilisez le lien officiel de la fiche Google Play.');const pkg=url.searchParams.get('id');if(!pkg||!/^\w+(\.\w+)+$/.test(pkg))throw Error('Le lien Google Play ne contient pas de paquet valide.');return pkg;}
export function deviceLabel(device,clients){const owner=clients.find(x=>x.id===device.client_id)?.name;return `${device.name} · ${owner||'Propriétaire non renseigné'}`;}
export function matchesRequest(request,device,query,filter){return(filter==='all'||request.status===filter)&&`${request.package_name || request.site_url || ''} ${device}`.toLocaleLowerCase('fr').includes(query.trim().toLocaleLowerCase('fr'));}
export function releaseReady(app){return /^https:\/\//.test(app.apk_url||'')&&/^[0-9a-f]{64}$/i.test(app.sha256||'')&&Number.isSafeInteger(Number(app.version_code))&&Number(app.version_code)>0;}


export function isDeviceId(value) {
  return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
}

export function siteRequestWindow(request, now = Date.now()) {
  if (request.package_name || request.requested_allowed === false) return null;
  const approvedUntil = Date.parse(request.allowed_until);
  if (request.status === 'approved' && Number.isFinite(approvedUntil)) {
    return { kind: approvedUntil > now ? 'approved' : 'expired', until: approvedUntil };
  }
  const requestedUntil = Date.parse(request.requested_until);
  if (Number.isFinite(requestedUntil)) {
    return { kind: requestedUntil > now ? 'requested' : 'expired', until: requestedUntil };
  }
  if (Number(request.requested_hours) === 24) return { kind: 'day' };
  return null;
}
