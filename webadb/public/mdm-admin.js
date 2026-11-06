import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { BASE_APPS, parsePlayUrl, deviceLabel, matchesRequest, releaseReady } from './mdm-model.js?v=20261030';
import { VIEWS, resolveView, mayImport } from './mdm-views.js?v=20261104';
import { checkPlayCatalog } from './mdm-play-updates.js?v=20261106';
import { inspectApk } from './mdm-apk.js?v=20261030';
const db=createClient('https://jqrznghqwdjbizjehzrm.supabase.co','sb_publishable_YG9zgjQ5Y56WiBtKdJMQvA_-UBAFv9B');
const GPLAY_API='http://127.0.0.1:5000';
const $=id=>document.getElementById(id),form=$('catalogForm');
let devices=[],clients=[],requests=[],catalog=[],currentUser=null,isOwner=false,uploaded=null;
let playCheckResults=new Map(),playCheckRun=0,playChecking=false,playAbort=null;
let view=resolveView(location.search,location.hash);
let embedded=false;
try { embedded=window.parent!==window && window.parent.location.origin===location.origin && new URLSearchParams(location.search).get('embed')==='classic'; } catch (_) {}
document.documentElement.classList.toggle('embedded',embedded);
function resizeParent(){
  if(!embedded)return;
  const height=Math.max(view==='catalog'?540:160,Math.ceil(document.querySelector('main').getBoundingClientRect().height)+2);
  window.parent.postMessage({type:'yidream-mdm:resize',height},location.origin);
}
new ResizeObserver(resizeParent).observe(document.querySelector('main'));
function showView(next){
  view=Object.hasOwn(VIEWS,next)?next:'home';
  for(const panel of document.querySelectorAll('[data-panel]'))panel.hidden=panel.dataset.panel!==view;
  for(const link of document.querySelectorAll('.nav-link')){const active=link.dataset.view===view;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
  $('viewTitle').textContent=VIEWS[view];$('viewCaption').textContent=VIEWS[view];
  document.title='YiDream · '+VIEWS[view];resizeParent();
}
function navigate(next){
  if(!Object.hasOwn(VIEWS,next))return;
  if(embedded)window.parent.postMessage({type:'yidream-mdm:navigate',view:next},location.origin);
  else {history.pushState(null,'','#mdm-'+next);showView(next);window.scrollTo({top:0});}
}
window.addEventListener('popstate',()=>showView(resolveView(location.search,location.hash)));
for(const link of document.querySelectorAll('[data-view]'))link.onclick=e=>{e.preventDefault();navigate(link.dataset.view);};
showView(view);
function resetEditor(){form.reset();delete form.dataset.editId;delete form.dataset.ownerId;uploaded=null;$('apkFile').value='';$('editorStatus').replaceChildren();$('apkInfo').textContent='L’application, sa version et son empreinte seront vérifiées avant publication.';}
function openEditor(){ $('ownerImports').hidden=!mayImport(currentUser,isOwner);$('baseControl').hidden=!isOwner;if(!$('catalogEditor').open)$('catalogEditor').showModal();if(embedded)window.parent.postMessage({type:'yidream-mdm:focus'},location.origin);else window.scrollTo({top:0});resizeParent(); }
$('addApp').onclick=()=>{resetEditor();$('editorTitle').textContent='Ajouter une application';openEditor();};
$('closeEditor').onclick=()=>$('catalogEditor').close();
async function ownerHeaders(){
  if(!mayImport(currentUser,isOwner))throw Error('Cet outil est réservé à l’admin des admins.');
  const allowed=check(await db.rpc('is_platform_owner'))===true;
  if(!allowed){isOwner=false;$('ownerImports').hidden=true;$('baseControl').hidden=true;hidePlayUpdates();uploaded=null;throw Error('Cet outil est réservé à l’admin des admins.');}
  const session=check(await db.auth.getSession()).session;
  if(!session?.access_token || session.user.id!==currentUser?.id){hidePlayUpdates();throw Error('Votre session a expiré. Reconnectez-vous.');}
  return {Authorization:'Bearer '+session.access_token};
}
const check=r=>{if(r.error)throw r.error;return r.data;};
const status=(message,error=false,showMigration=false)=>{
  for(const node of [$('status'),$('editorStatus')]){node.replaceChildren();node.textContent=message;node.classList.toggle('error',error);if(showMigration&&isOwner){node.append(' ');const link=document.createElement('a');link.href='./mdm-setup.sql';link.target='_blank';link.rel='noopener';link.textContent='Ouvrir la mise à jour Supabase';node.append(link);}}
};
const button=(label,kind='secondary')=>{const b=document.createElement('button');b.type='button';b.className='button '+kind;b.textContent=label;return b;};
const text=(tag,value,className)=>{const e=document.createElement(tag);e.textContent=value;if(className)e.className=className;return e;};
function empty(parent,title,description){const box=document.createElement('div');box.className='empty';box.append(text('div','◎','empty-symbol'),text('strong',title),text('p',description));parent.append(box);}
function isCatalogSchemaError(e){return e?.code==='PGRST204'||(e?.message||'').includes("'is_base' column of 'yd_catalog'");}
function errorMessage(e){return isCatalogSchemaError(e)?'La base YiDream doit être mise à jour avant d’utiliser la boutique.':(['PGRST202','PGRST205','42P01','42703'].includes(e.code)?'La mise à jour du service MDM doit être activée par le responsable de votre espace.':(e.message||'Connexion impossible. Réessayez.'));}
async function task(b,operation){if(b)b.disabled=true;try{await operation();}catch(e){status(errorMessage(e),true,isCatalogSchemaError(e));}finally{if(b)b.disabled=false;}}
function renderRequests(){const container=$('requests');container.replaceChildren();const filtered=requests.filter(r=>matchesRequest(r,deviceLabel(devices.find(d=>d.id===r.device_id)||{name:'Appareil'},clients),$('requestSearch').value,$('requestFilter').value));if(!filtered.length)empty(container,'Aucune demande à afficher','Les demandes de vos utilisateurs apparaîtront ici.');for(const request of filtered){const row=document.createElement('article');row.className='row';const heading=document.createElement('div');heading.className='request-heading';let name;try{name=new URL(request.site_url).hostname;}catch(_){name=request.site_url;}heading.append(text('strong',name),text('span',({pending:'En attente',approved:'Acceptée',rejected:'Refusée',revoked:'Révoquée'})[request.status]||request.status,'pill '+request.status));const device=devices.find(d=>d.id===request.device_id);row.append(heading,text('small',`${deviceLabel(device||{name:'Appareil'},clients)} · ${new Date(request.created_at).toLocaleString('fr')}`));if(request.reason)row.append(text('p',request.reason));if(request.admin_note)row.append(text('p',request.admin_note));if(['pending','approved','revoked'].includes(request.status)){const note=document.createElement('textarea');note.placeholder='Votre réponse à l’utilisateur (facultatif)';note.maxLength=2000;note.rows=2;note.setAttribute('aria-label','Réponse pour '+name);row.append(note);const actions=document.createElement('div');actions.className='row-actions';const choices=request.status==='pending'?[['approved','Accepter','primary'],['rejected','Refuser','ghost']]:request.status==='approved'?[['revoked','Révoquer l’autorisation','danger']]:[['approved','Réautoriser','secondary']];for(const[decision,label,kind]of choices){const b=button(label,kind);b.onclick=()=>task(b,async()=>{check(await db.rpc('yd_review_site',{request_id:request.id,decision,note:note.value}));await load();status(decision==='revoked'?'Autorisation révoquée. La décision sera visible sur le téléphone.':'Décision enregistrée.');});actions.append(b);}row.append(actions);}container.append(row);}}
function fillApp(app){form.elements.name.value=app.name||'';form.elements.package_name.value=app.package_name||'';form.elements.description.value=app.description||'';for(const key of['source_url','version_name','version_code','apk_url','sha256'])form.elements[key].value=app[key]||'';form.elements.is_base.checked=!!app.is_base;form.dataset.editId=app.id||'';form.dataset.ownerId=app.owner_id||currentUser.id;uploaded=null;$('apkFile').value='';$('apkInfo').textContent='Importez une nouvelle APK pour publier une mise à jour.';$('editorTitle').textContent='Publier une version · '+app.name;openEditor();}
function renderCatalog(){
 const container=$('catalog');container.replaceChildren();
 const query=$('catalogSearch').value.trim().toLocaleLowerCase('fr');
 const visible=catalog.filter(app=>[app.name,app.package_name,app.description].some(value=>(value||'').toLocaleLowerCase('fr').includes(query)));
 if(!visible.length)empty(container,catalog.length?'Aucun résultat':'Votre boutique prend forme',catalog.length?'Essayez un autre nom d’application.':'Ajoutez une première application pour vos appareils.');
 for(const app of visible){
  const row=document.createElement('article');row.className='catalog-row';
  const identity=document.createElement('div');identity.className='app-identity';
  const title=document.createElement('div');title.append(text('strong',app.name),text('small',app.package_name));
  identity.append(text('span',(app.name||'?').slice(0,1),'app-avatar'),title);
  const detail=document.createElement('div');detail.className='app-detail';detail.append(text('p',app.description||'Application Android'),text('small',app.is_base?'Application de base':'Votre catalogue'));
  const release=document.createElement('div');release.className='app-release';release.append(text('small',app.version_name?'Version '+app.version_name:'APK à préparer'),text('span',!app.enabled?'Masquée':releaseReady(app)?'Disponible':'À compléter','pill '+(app.enabled&&releaseReady(app)?'approved':'pending')));
  const actions=document.createElement('div');actions.className='row-actions';
  if(isOwner||app.owner_id===currentUser.id){const edit=button('Publier une version');edit.onclick=()=>fillApp(app);const toggle=button(app.enabled?'Masquer':'Afficher','ghost');toggle.onclick=()=>task(toggle,async()=>{check(await db.from('yd_catalog').update({enabled:!app.enabled}).eq('id',app.id));await load();});actions.append(edit,toggle);}
  if(app.source_url){try{const url=new URL(app.source_url);if(url.protocol==='https:'){const link=document.createElement('a');link.className='button ghost';link.textContent='Fiche officielle ↗';link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);}}catch(_){} }
  row.append(identity,detail,release,actions);container.append(row);
 }
 resizeParent();
}
function hidePlayUpdates(){
 playCheckRun++;playAbort?.abort();playAbort=null;playChecking=false;playCheckResults.clear();
 $('playUpdates').hidden=true;$('playUpdateResults').replaceChildren();$('playUpdatesProgress').textContent='';
 $('checkPlayUpdates').disabled=false;$('retryPlayUpdates').hidden=true;
}
function renderPlayUpdates(){
 if(!mayImport(currentUser,isOwner)){hidePlayUpdates();return;}
 $('playUpdates').hidden=false;const container=$('playUpdateResults');container.replaceChildren();
 for(const app of catalog){
  const result=playCheckResults.get(app.id);if(!result)continue;
  const row=document.createElement('article');row.className='play-update-row';
  const detail=document.createElement('div');detail.append(text('strong',app.name),text('small',app.package_name+(app.enabled?'':' · Masquée')));
  const labels={update:'Nouvelle version signalée',current:'Même code de version que le catalogue',older:'Version Play inférieure au catalogue',prepare:'Première version à préparer',unconfirmed:'Version à confirmer dans l’APK',error:'Vérification impossible'};
  detail.append(text('span',labels[result.kind],'pill '+(result.kind==='current'?'approved':'pending')));
  if(result.kind==='error')detail.append(text('p',result.message));
  else detail.append(text('p',result.code==null?'Le fournisseur ne donne pas de code de version Android fiable. Téléchargez l’APK pour vérifier sa version.':
   `Google Play : ${result.name||'version non précisée'} (code ${result.code}) · Catalogue : ${result.publishedCode??'non publié'}`));
  row.append(detail);
  if(result.canPrepare){const prepare=button('Préparer la mise à jour');prepare.disabled=playChecking;prepare.onclick=()=>task(prepare,async()=>{
   await ownerHeaders();const current=catalog.find(item=>item.id===app.id);if(!current)throw Error('Cette application n’est plus dans le catalogue.');
   fillApp(current);form.elements.source_url.value=result.source;$('downloadPlay').click();
  });row.append(prepare);}
  container.append(row);
 }
 $('retryPlayUpdates').hidden=playChecking||![...playCheckResults.values()].some(result=>result.kind==='error');
 resizeParent();
}
async function runPlayChecks(retry=false){
 if(playChecking)return;
 await ownerHeaders();const run=++playCheckRun,account=currentUser.id;
 const apps=catalog.filter(app=>!retry||playCheckResults.get(app.id)?.kind==='error').map(app=>({...app}));
 if(!retry)playCheckResults.clear();playChecking=true;$('checkPlayUpdates').disabled=true;$('retryPlayUpdates').hidden=true;
 let completed=0;$('playUpdatesProgress').textContent=apps.length?'Vérification 0/'+apps.length+'…':'Aucune application à vérifier.';renderPlayUpdates();
 const active=()=>run===playCheckRun&&mayImport(currentUser,isOwner)&&currentUser.id===account;
 try{
  await checkPlayCatalog(apps,async app=>{
   const headers=await ownerHeaders();if(!active())throw Error('Vérification interrompue.');
   const controller=new AbortController();playAbort=controller;const timeout=setTimeout(()=>controller.abort(),20000);
   try{
    let response;try{response=await fetch(GPLAY_API+'/api/info/'+encodeURIComponent(app.package_name),{headers,cache:'no-store',redirect:'error',signal:controller.signal});}
    catch(_){throw Error('Le service Google Play local ne répond pas. Consultez « Activer le service », puis réessayez.');}
    if(!response.ok)throw Error('Le fournisseur a refusé la vérification (code '+response.status+').');
    return await response.json();
   }finally{clearTimeout(timeout);if(playAbort===controller)playAbort=null;}
  },(app,result)=>{playCheckResults.set(app.id,result);completed++;$('playUpdatesProgress').textContent=`Vérification ${completed}/${apps.length}…`;renderPlayUpdates();},active);
 }finally{
  if(active()){playChecking=false;$('checkPlayUpdates').disabled=false;$('playUpdatesProgress').textContent=`${completed}/${apps.length} fiches traitées · ${[...playCheckResults.values()].filter(result=>result.kind==='error').length} échec(s). Les APK restent à préparer et à publier.`;renderPlayUpdates();}
 }
}
$('checkPlayUpdates').onclick=e=>task(e.currentTarget,()=>runPlayChecks());
$('retryPlayUpdates').onclick=e=>task(e.currentTarget,()=>runPlayChecks(true));
async function load(){hidePlayUpdates();isOwner=false;$('ownerImports').hidden=true;$('baseControl').hidden=true;const session=check(await db.auth.getSession()).session;$('login').hidden=!!session;if(!session){currentUser=null;uploaded=null;$('catalogEditor').close();$('workspace').hidden=true;$('account').textContent='Espace administrateur';status('Connectez-vous pour retrouver vos appareils.');return;}currentUser=session.user;const role=check(await db.from('platform_admins').select('role').eq('user_id',currentUser.id).maybeSingle());if(!role || check(await db.rpc('is_platform_admin'))!==true){$('catalogEditor').close();$('workspace').hidden=true;status('Ce compte ne dispose pas d’un accès administrateur.',true);return;}isOwner=role.role==='owner'&&check(await db.rpc('is_platform_owner'))===true;$('ownerImports').hidden=!isOwner;const result=await Promise.all([db.from('devices').select('id,name,user_id,client_id').order('name'),db.from('clients').select('id,name'),db.from('yd_site_requests').select('*').order('created_at',{ascending:false}).limit(200),db.from('yd_catalog').select('*').order('name')]);[devices,clients,requests,catalog]=result.map(check);const selected=$('devices').value;$('devices').replaceChildren(...devices.map(d=>{const o=document.createElement('option');o.value=d.id;o.textContent=deviceLabel(d,clients);return o;}));if(devices.some(d=>d.id===selected))$('devices').value=selected;$('pair').disabled=!devices.length;const count=requests.filter(r=>r.status==='pending').length;$('pendingCount').textContent=count;$('navPending').textContent=count;$('navPending').hidden=!count;$('appCount').textContent=catalog.filter(a=>a.enabled&&releaseReady(a)).length;$('deviceCount').textContent=devices.length;$('requestTotal').textContent=requests.length+' demandes';$('catalogTotal').textContent=catalog.length+' applications';$('account').textContent=currentUser.email;$('baseControl').hidden=!isOwner;renderRequests();renderCatalog();renderPlayUpdates();$('workspace').hidden=false;showView(view);status('');}
$('loginForm').onsubmit=e=>{e.preventDefault();task(e.submitter,async()=>{check(await db.auth.signInWithPassword({email:$('email').value,password:$('password').value}));$('password').value='';await load();});};
$('refresh').onclick=e=>task(e.currentTarget,load);$('viewRefresh').onclick=e=>task(e.currentTarget,load);$('catalogSearch').oninput=renderCatalog;$('requestSearch').oninput=renderRequests;$('requestFilter').onchange=renderRequests;
$('pair').onclick=e=>task(e.target,async()=>{const code=check(await db.rpc('yd_create_pairing',{target_device:$('devices').value}));$('pairCode').textContent=code;$('pairResult').hidden=false;});
$('devices').onchange=()=>{$('pairResult').hidden=true;$('pairCode').textContent='';};
$('copyCode').onclick=e=>task(e.target,async()=>{await navigator.clipboard.writeText($('pairCode').textContent);status('Code copié.');});
$('importPlay').onclick=e=>task(e.currentTarget,async()=>{const headers=await ownerHeaders();const pkg=parsePlayUrl($('playUrl').value);form.elements.package_name.value=pkg;form.elements.source_url.value='https://play.google.com/store/apps/details?id='+encodeURIComponent(pkg);const preset=BASE_APPS.find(a=>a.package_name===pkg);if(preset){form.elements.name.value=preset.name;form.elements.description.value=preset.description;form.elements.is_base.checked=isOwner;}let response;try{response=await fetch(GPLAY_API+'/api/info/'+encodeURIComponent(pkg),{headers,cache:'no-store',redirect:'error'});}catch(_){throw Error('Le service local ne répond pas. Démarrez-le selon le guide « Configurer le service ».');}const info=await response.json();if(!response.ok||info.error)throw Error(info.error||'Impossible de lire la fiche Google Play.');if(info.title&&info.title!==pkg)form.elements.name.value=info.title;if(info.developer&&info.developer!=='Unknown')form.elements.description.value='Éditeur : '+info.developer;status('Fiche Google Play reconnue. Cliquez sur « Télécharger l’APK » pour la préparer.');});
$('downloadPlay').onclick=e=>task(e.currentTarget,async()=>{const headers=await ownerHeaders();const pkg=parsePlayUrl($('playUrl').value);form.elements.package_name.value=pkg;form.elements.source_url.value='https://play.google.com/store/apps/details?id='+encodeURIComponent(pkg);$('apkInfo').textContent='Téléchargement depuis Google Play…';let response;try{response=await fetch(GPLAY_API+'/api/download-merged/'+encodeURIComponent(pkg)+'?arch=arm64-v8a',{headers,cache:'no-store',redirect:'error'});}catch(_){throw Error('Le service Google Play local est introuvable. Consultez le guide de démarrage ci-dessous.');}const type=response.headers.get('content-type')||'';if(!response.ok||type.includes('application/json')){let detail='Téléchargement impossible. Vérifiez la connexion au service Google Play.';try{const payload=await response.json();detail=payload.error||detail;}catch(_){}throw Error(detail);}const blob=await response.blob();if(!blob.size)throw Error('Le service a renvoyé un fichier APK vide.');const file=new File([blob],pkg+'.apk',{type:'application/vnd.android.package-archive'});const metadata=await inspectApk(file);if(metadata.package_name!==pkg)throw Error('Le paquet de l’APK reçu ne correspond pas au lien Google Play.');uploaded={file,...metadata};for(const k of['package_name','version_code','version_name','sha256'])form.elements[k].value=metadata[k];if(!form.elements.name.value||form.elements.name.value===pkg)form.elements.name.value=BASE_APPS.find(a=>a.package_name===pkg)?.name||pkg;form.elements.apk_url.value='';$('apkInfo').textContent=`APK récupéré · version ${metadata.version_name} · ${(file.size/1048576).toFixed(1)} Mo · empreinte vérifiée. Vérifiez les avertissements avant publication.`;status('APK prêt. Vérifiez les informations, puis publiez-le dans la boutique YiDream.');});
$('apkFile').onchange=e=>task(null,async()=>{uploaded=null;await ownerHeaders();const file=e.target.files?.[0];if(!file)return;$('apkInfo').textContent='Lecture du fichier APK…';const metadata=await inspectApk(file);uploaded={file,...metadata};for(const k of['package_name','version_code','version_name','sha256'])form.elements[k].value=metadata[k];const preset=BASE_APPS.find(a=>a.package_name===metadata.package_name);if(preset&&!form.elements.name.value){form.elements.name.value=preset.name;form.elements.description.value=preset.description;form.elements.source_url.value=preset.source_url;}form.elements.apk_url.value='';$('apkInfo').textContent=`${metadata.package_name} · version ${metadata.version_name} · ${(file.size/1048576).toFixed(1)} Mo · fichier vérifié`;});
form.onsubmit=e=>{e.preventDefault();task(e.submitter,async()=>{const values=Object.fromEntries(new FormData(form));values.is_base=isOwner&&form.elements.is_base.checked;values.version_code=values.version_code?Number(values.version_code):null;for(const k of['apk_url','sha256','version_name','source_url'])values[k]=values[k]?.trim()||null;if(values.source_url)parsePlayUrl(values.source_url);let newPath=null;try{if(uploaded){await ownerHeaders();newPath=`${isOwner?(form.dataset.ownerId||currentUser.id):currentUser.id}/${uploaded.package_name}/${uploaded.sha256}.apk`;check(await db.storage.from('yd-apks').upload(newPath,uploaded.file,{contentType:'application/vnd.android.package-archive',upsert:true}));values.apk_url=`https://jqrznghqwdjbizjehzrm.supabase.co/storage/v1/object/authenticated/yd-apks/${newPath}`;values.storage_path=newPath;}else if(values.apk_url){const u=new URL(values.apk_url);if(u.protocol!=='https:'||u.username||u.password)throw Error('Utilisez un lien HTTPS sans identifiants.');}if(values.apk_url&&!releaseReady(values))throw Error('Le paquet, le code de version et le SHA-256 sont nécessaires pour publier un APK.');if(!uploaded&&form.dataset.editId){const previous=catalog.find(a=>a.id===form.dataset.editId);if(previous&&values.apk_url!==previous.apk_url)values.storage_path=null;}if(form.dataset.editId){check(await db.from('yd_catalog').update({...values,enabled:catalog.find(app=>app.id===form.dataset.editId)?.enabled??true}).eq('id',form.dataset.editId));}else{check(await db.from('yd_catalog').upsert({...values,owner_id:currentUser.id,enabled:true},{onConflict:'owner_id,package_name'}));}form.reset();delete form.dataset.editId;delete form.dataset.ownerId;uploaded=null;$('apkInfo').textContent='Le nom du paquet, la version et l’empreinte sont lus dans le fichier APK.';$('catalogEditor').close();await load();status('Application enregistrée dans la boutique.');}catch(error){if(newPath)status('Le fichier APK est envoyé, mais sa publication a échoué. Réessayez.',true);throw error;}});};
db.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')hidePlayUpdates();if(event==='SIGNED_OUT'||event==='SIGNED_IN')setTimeout(()=>task(null,load),0);});
await task(null,load);
