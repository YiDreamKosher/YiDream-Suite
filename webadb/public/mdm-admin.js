import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { BASE_APPS, parsePlayUrl, deviceLabel, matchesRequest, releaseReady, siteRequestWindow, isDeviceId } from './mdm-model.js?v=20261112-account-windows';
import { VIEWS, resolveView, mayImport } from './mdm-views.js?v=20261112';
import { accountText, translateAccountPanel } from './mdm-app-accounts-i18n.js?v=20261112-device-management';
import { checkPlayCatalog } from './mdm-play-updates.js?v=20261106';
import { inspectApk } from './mdm-apk.js?v=20261030';
const db=createClient('https://jqrznghqwdjbizjehzrm.supabase.co','sb_publishable_YG9zgjQ5Y56WiBtKdJMQvA_-UBAFv9B');
const GPLAY_API='http://127.0.0.1:5000';
const $=id=>document.getElementById(id),form=$('catalogForm');
const selectedLanguage=new URLSearchParams(location.search).get('lang')||localStorage.getItem('yidream-admin-language');
const accountLanguage=['en','fr','he','yi'].includes(selectedLanguage)?selectedLanguage:'en';
const accountCopy=value=>accountText(value,accountLanguage);
translateAccountPanel($('pairPanel'),accountLanguage);
translateAccountPanel($('requestsPanel'),accountLanguage);
for(const element of document.querySelectorAll('[data-view="pair"]'))translateAccountPanel(element,accountLanguage);
let devices=[],clients=[],requests=[],catalog=[],currentUser=null,isOwner=false,uploaded=null;
let accountLoad=0,workspaceLoad=0,codeExpiryTimer=null;
let linkAccount=null,linkGeneration=0;
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
  $('viewTitle').textContent=accountCopy(VIEWS[view]);$('viewCaption').textContent=accountCopy(VIEWS[view]);
  document.title='YiDream · '+accountCopy(VIEWS[view]);resizeParent();
  if(view==='pair'&&currentUser)void loadAppAccounts();
  else if(view!=='pair')closeAccountLink();
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
  for(const node of [$('status'),$('editorStatus')]){node.replaceChildren();node.textContent=accountCopy(message);node.classList.toggle('error',error);if(showMigration&&isOwner){node.append(' ');const link=document.createElement('a');link.href='./mdm-setup.sql';link.target='_blank';link.rel='noopener';link.textContent='Ouvrir la mise à jour Supabase';node.append(link);}}
};
const button=(label,kind='secondary')=>{const b=document.createElement('button');b.type='button';b.className='button '+kind;b.textContent=accountCopy(label);return b;};
const text=(tag,value,className)=>{const e=document.createElement(tag);e.textContent=accountCopy(value);if(className)e.className=className;return e;};
function empty(parent,title,description){const box=document.createElement('div');box.className='empty';box.append(text('div','◎','empty-symbol'),text('strong',title),text('p',description));parent.append(box);}
function isCatalogSchemaError(e){return e?.code==='PGRST204'||(e?.message||'').includes("'is_base' column of 'yd_catalog'");}
function errorMessage(error) {
  if (isCatalogSchemaError(error)) return 'La base YiDream doit être mise à jour avant d’utiliser la boutique.';
  if (['PGRST202', 'PGRST205', '42P01', '42703'].includes(error.code)) {
    return 'La mise à jour du service MDM doit être activée par le responsable de votre espace.';
  }
  const messages = {
    INVALID_CONTACT: 'Vérifiez l’e-mail et saisissez un numéro avec son indicatif international.',
    APP_ACCOUNT_NOT_AVAILABLE: 'Ce compte ne peut plus être associé. Actualisez la liste.',
    APP_ACCOUNT_ALREADY_LINKED: 'Ce compte est déjà associé à un autre appareil.',
    APP_ACCESS_DENIED: 'Cette opération n’est pas disponible pour ce compte ou cet appareil.',
    CONFIGURED_DEVICE_REQUIRED: 'Choisissez l’identifiant d’un appareil Android configuré dans votre espace.',
    SITE_WINDOW_EXPIRED: 'La date de fin souhaitée est passée.',
    MP3_WEB_DISABLED: 'Le profil MP3 ne permet pas d’autoriser un site.',
    INVALID_REQUEST_SCOPE: 'La sélection contient un appareil indisponible. Vérifiez les appareils choisis.',
    SCOPED_RULE_LIMIT: 'Un appareil a atteint la limite de règles. La décision n’a pas été enregistrée.',
    SITE_REQUEST_NOT_AVAILABLE: 'Cette demande a changé ou n’est plus disponible. Actualisez la liste.'
  };
  return messages[error.message] || error.message || 'Connexion impossible. Réessayez.';
}
async function task(b,operation){if(b)b.disabled=true;try{await operation();}catch(e){status(errorMessage(e),true,isCatalogSchemaError(e));}finally{if(b)b.disabled=false;}}

function requestScope(device) {
  const eligible = device && devices.filter(target => target.id !== device.id &&
    target.user_id === device.user_id && target.platform === 'Android' &&
    target.configuration_status === 'configured');
  if (!eligible?.length) return null;
  const control = document.createElement('div');
  control.className = 'request-scope';
  const label = text('label', accountCopy('Appliquer à'));
  const mode = document.createElement('select');
  const clientDevices = device.client_id
    ? eligible.filter(target => target.client_id === device.client_id)
    : [];
  for (const [value, title] of [
    ['device', 'Appareil demandeur'],
    ...(clientDevices.length ? [['client', 'Appareils du même client']] : []),
    ['selected', 'Appareils sélectionnés'],
    ['shop', 'Tous les Android éligibles de cette boutique']
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = accountCopy(title);
    mode.append(option);
  }
  label.append(mode);
  const list = document.createElement('fieldset');
  list.hidden = true;
  list.append(text('legend', accountCopy('Ajouter des appareils à la demande')));
  for (const target of eligible) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = target.id;
    const label = text('label', deviceLabel(target, clients));
    label.prepend(input);
    list.append(label);
  }
  mode.onchange = () => { list.hidden = mode.value !== 'selected'; };
  control.append(label, list);
  return {
    control,
    selection() {
      if (mode.value === 'client') {
        return { target_devices: [device.id, ...clientDevices.map(target => target.id)], all_devices: false };
      }
      const targets = Array.from(list.querySelectorAll('input:checked'), input => input.value);
      if (mode.value === 'selected' && !targets.length) {
        throw Error(accountCopy('Sélectionnez au moins un appareil supplémentaire.'));
      }
      return { target_devices: mode.value === 'selected' ? [device.id, ...targets] : null, all_devices: mode.value === 'shop' };
    }
  };
}

function renderRequests() {
  const container = $('requests');
  container.replaceChildren();
  const filtered = requests.filter(request => matchesRequest(
    request,
    deviceLabel(devices.find(device => device.id === request.device_id) || { name: 'Appareil' }, clients),
    $('requestSearch').value, $('requestFilter').value
  ));
  if (!filtered.length) empty(container, 'Aucune demande à afficher', 'Les demandes de vos utilisateurs apparaîtront ici.');
  for (const request of filtered) {
    const row = document.createElement('article');
    row.className = 'row';
    const heading = document.createElement('div');
    heading.className = 'request-heading';
    const isApp = Boolean(request.package_name);
    let name = request.package_name;
    if (!isApp) {
      try { name = new URL(request.site_url).hostname; }
      catch { name = request.site_url; }
    }
    const wantsAllow = request.requested_allowed !== false;
    const timing = siteRequestWindow(request);
    const expired = timing?.kind === 'expired';
    const labels = { pending: 'En attente', approved: 'Acceptée', rejected: 'Refusée', revoked: 'Révoquée' };
    const statusLabel = expired && request.status === 'approved' ? 'Expirée' : labels[request.status] || request.status;
    heading.append(text('strong', name), text('span', statusLabel, 'pill ' + (expired && request.status === 'approved' ? 'revoked' : request.status)));
    const device = devices.find(device => device.id === request.device_id);
    row.append(heading, text('small', deviceLabel(device || { name: 'Appareil' }, clients) + ' · ' +
      new Date(request.created_at).toLocaleString(accountLanguage)));
    row.append(text('p', isApp ? 'Demande d’accès à une application' : wantsAllow ? 'Demande d’autorisation' : 'Demande de blocage'));
    if (timing) {
      const label = { approved: 'Fin de l’autorisation', expired: 'Date de fin passée', requested: 'Date de fin souhaitée' }[timing.kind];
      const note = timing.kind === 'day'
        ? accountCopy('24 heures à compter de l’approbation')
        : accountCopy(label) + ' · ' + new Date(timing.until).toLocaleString(accountLanguage);
      row.append(text('p', note, 'request-timing'));
    }
    if (request.reason) row.append(text('p', request.reason));
    if (request.admin_note) row.append(text('p', request.admin_note));
    const actions = [];
    if (request.status === 'pending') {
      const approval = isApp ? 'Autoriser l’application' : wantsAllow ? 'Autoriser le site' : 'Bloquer le site';
      if (!expired) actions.push(['approved', approval, 'primary']);
      actions.push(['rejected', 'Refuser', 'ghost']);
    } else if (wantsAllow && request.status === 'approved' && !expired) {
      actions.push(['revoked', 'Révoquer l’autorisation', 'danger']);
    } else if (wantsAllow && request.status === 'revoked' && !expired) {
      actions.push(['approved', 'Réautoriser', 'secondary']);
    }
    if (actions.length) {
      const note = document.createElement('textarea');
      note.placeholder = accountCopy('Votre réponse à l’utilisateur (facultatif)');
      note.maxLength = 2000;
      note.rows = 2;
      note.setAttribute('aria-label', note.placeholder);
      row.append(note);
      const scope = wantsAllow && actions.some(([decision]) => decision === 'approved')
        ? requestScope(device) : null;
      if (scope) row.append(scope.control);
      const actionBar = document.createElement('div');
      actionBar.className = 'row-actions';
      for (const [decision, label, kind] of actions) {
        const action = button(label, kind);
        action.onclick = () => task(action, async () => {
          const targets = decision === 'approved' && scope ? scope.selection() : { target_devices: null, all_devices: false };
          const result = device?.platform !== 'Android' && !isApp
            ? check(await db.rpc('yd_review_site', { request_id: request.id, decision, note: note.value }))
            : check(await db.rpc('yd_review_device_request', {
            request_kind: isApp ? 'app' : 'site', request_id: request.id, decision, note: note.value, ...targets
          }));
          await load();
          status(decision === 'approved' && result > 1
            ? `Autorisation enregistrée pour ${result} appareils.` : 'Décision enregistrée.');
        });
        actionBar.append(action);
      }
      row.append(actionBar);
    }
    container.append(row);
  }
}
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
async function load() {
  const generation = ++workspaceLoad;
  hidePlayUpdates();
  isOwner = false;
  $('ownerImports').hidden = true;
  $('baseControl').hidden = true;
  const session = check(await db.auth.getSession()).session;
  if (generation !== workspaceLoad) return;
  $('login').hidden = Boolean(session);
  if (!session) {
    currentUser = null;
    uploaded = null;
    resetAppAccounts();
    $('catalogEditor').close();
    $('workspace').hidden = true;
    $('account').textContent = 'Espace administrateur';
    status('Connectez-vous pour retrouver vos appareils.');
    return;
  }

  const user = session.user;
  if (currentUser && user.id !== currentUser.id) {
    currentUser = null;
    resetAppAccounts();
    $('workspace').hidden = true;
  }
  const role = check(await db.from('platform_admins').select('role').eq('user_id', user.id).maybeSingle());
  const active = role && check(await db.rpc('is_platform_admin')) === true;
  if (generation !== workspaceLoad) return;
  if (!active) {
    currentUser = null;
    resetAppAccounts();
    $('catalogEditor').close();
    $('workspace').hidden = true;
    status('Ce compte ne dispose pas d’un accès administrateur.', true);
    return;
  }

  const owner = role.role === 'owner' && check(await db.rpc('is_platform_owner')) === true;
  const [deviceRows, clientRows, siteRows, catalogRows, appRows] = await Promise.all([
    db.from('devices').select('id,name,user_id,client_id,configuration_status,platform').order('name'),
    db.from('clients').select('id,name'),
    db.from('yd_site_requests').select('*').order('created_at', { ascending: false }).limit(200),
    db.from('yd_catalog').select('*').order('name'),
    db.rpc('yd_admin_app_requests')
  ]);
  if (generation !== workspaceLoad) return;
  [devices, clients, catalog] = [deviceRows, clientRows, catalogRows].map(check);
  const siteRequests = check(siteRows);
  // A console deployment can briefly precede the database migration.
  const appRequestsUnavailable = appRows.error?.code === 'PGRST202';
  const appRequests = appRequestsUnavailable ? [] : check(appRows);
  requests = [...siteRequests, ...appRequests].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  currentUser = user;
  isOwner = owner;
  $('ownerImports').hidden = !isOwner;

  $('configuredDevices').replaceChildren(...configuredDevices().map(device => {
    const option = document.createElement('option');
    option.value = device.id;
    option.label = deviceLabel(device, clients);
    return option;
  }));

  const pending = requests.filter(request => request.status === 'pending').length;
  $('pendingCount').textContent = pending;
  $('navPending').textContent = pending;
  $('navPending').hidden = !pending;
  $('appCount').textContent = catalog.filter(app => app.enabled && releaseReady(app)).length;
  $('deviceCount').textContent = devices.length;
  $('requestTotal').textContent = new Intl.NumberFormat(accountLanguage).format(requests.length);
  $('catalogTotal').textContent = catalog.length + ' applications';
  $('account').textContent = user.email;
  $('baseControl').hidden = !isOwner;

  renderRequests();
  renderCatalog();
  renderPlayUpdates();
  $('workspace').hidden = false;
  showView(view);
  status(appRequestsUnavailable ? 'Les demandes d’applications seront disponibles après la mise à jour du service.' : '');
}
function configuredDevices() {
  return devices.filter(device => device.configuration_status === 'configured' && device.platform === 'Android');
}

function openAccountLink(account) {
  closeAccountLink();
  linkAccount = account.id;
  const linkForm = $('pairForm');
  const row = Array.from($('appAccounts').children).find(node => node.dataset.accountId === account.id);
  row?.after(linkForm);
  $('pairAccount').textContent = account.email;
  $('devices').value = account.device_id || account.pending_device_id || '';
  $('devices').readOnly = Boolean(account.device_id);
  $('replaceAccountHint').hidden = Boolean(account.device_id);
  row?.querySelector('[data-link-account]')?.setAttribute('aria-expanded', 'true');
  linkForm.hidden = false;
  $('devices').focus();
  resizeParent();
}

function closeAccountLink() {
  linkGeneration++;
  const button = Array.from($('appAccounts').querySelectorAll('[data-link-account]'))
    .find(node => node.dataset.linkAccount === linkAccount);
  button?.setAttribute('aria-expanded', 'false');
  linkAccount = null;
  $('pairForm').hidden = true;
  $('devices').value = '';
  $('pairAccount').textContent = '';
  clearAccountCode();
  return button;
}

function resetAppAccounts() {
  accountLoad++;
  closeAccountLink();
  $('appAccounts').after($('pairForm'));
  $('appAccounts').replaceChildren();
  $('createAccountForm').reset();
  $('createAccountForm').hidden = true;
}

function renderAppAccount(account) {
  const row = document.createElement('article');
  row.className = 'app-account-row';
  row.dataset.accountId = account.id;
  const identity = document.createElement('div');
  identity.className = 'app-account-identity';
  identity.append(text('strong', account.email), text('small', account.contact_phone));
  if (account.device_id) {
    const device = text('small', account.device_name || 'Téléphone associé');
    device.title = account.device_id;
    identity.append(device);
  }
  const pendingUntil = Date.parse(account.pending_expires_at);
  if (account.is_active && pendingUntil > Date.now()) {
    const nextDevice = devices.find(device => device.id === account.pending_device_id);
    identity.append(text('small', [
      accountCopy('Activation en attente'),
      nextDevice?.name,
      accountCopy('Expire le') + ' ' + new Date(pendingUntil).toLocaleString(accountLanguage)
    ].filter(Boolean).join(' · ')));
  }

  const badges = document.createElement('div');
  badges.className = 'account-badges';
  const label = !account.is_active ? 'Suspendu' : account.device_id ? 'Actif' : 'En attente d’un appareil';
  const appearance = !account.is_active ? 'revoked' : account.device_id ? 'approved' : 'pending';
  badges.append(text('span', label, 'pill ' + appearance));
  if (account.email_verified) badges.append(text('small', 'E-mail vérifié'));
  row.append(identity, badges);

  if (account.can_manage === true) {
    const actions = document.createElement('div');
    actions.className = 'account-actions';
    if (account.can_assign && configuredDevices().some(device => !account.device_id || device.id === account.device_id)) {
      const link = button(account.device_id ? 'Nouveau code d’activation' : 'Associer un appareil');
      link.dataset.linkAccount = account.id;
      link.setAttribute('aria-controls', 'pairForm');
      link.setAttribute('aria-expanded', String(account.id === linkAccount));
      link.setAttribute('aria-label', link.textContent + ' · ' + account.email);
      link.onclick = () => openAccountLink(account);
      actions.append(link);
    }
    const toggle = button(account.is_active ? 'Suspendre' : 'Réactiver', account.is_active ? 'danger' : 'secondary');
    toggle.setAttribute('aria-label', toggle.textContent + ' · ' + account.email);
    toggle.onclick = () => task(toggle, async () => {
      const prompt = account.is_active
        ? 'Suspendre l’accès à l’application pour ce compte ? Le filtre installé restera actif.'
        : 'Réactiver l’accès à l’application pour ce compte ?';
      if (!confirm(accountCopy(prompt))) return;
      check(await db.rpc('yd_set_app_account_access', { target_account: account.id, enabled: !account.is_active }));
      if (linkAccount === account.id) closeAccountLink();
      await loadAppAccounts();
      status('Accès au compte mis à jour.');
    });
    actions.append(toggle);
    row.append(actions);
  }
  return row;
}

async function loadAppAccounts() {
  const generation = ++accountLoad;
  const list = $('appAccounts'), message = $('appAccountsStatus');
  message.textContent = accountCopy('Chargement des comptes…');
  $('refreshAccounts').disabled = true;
  try {
    const rows = check(await db.rpc('yd_list_app_accounts_v2')) || [];
    if (generation !== accountLoad || !currentUser || view !== 'pair') return;
    const nodes = rows.map(renderAppAccount);
    const activeRow = rows.findIndex(account => account.id === linkAccount && account.can_assign);
    const linkForm = $('pairForm');
    const focused = linkForm.contains(document.activeElement) ? document.activeElement : null;
    if (activeRow < 0) closeAccountLink();
    list.replaceChildren(...nodes);
    if (activeRow >= 0) {
      nodes[activeRow].after(linkForm);
      focused?.focus({ preventScroll: true });
    } else list.after(linkForm);
    $('createAccountForm').hidden = false;
    if (!rows.length) empty(list, 'Aucun compte', 'Vous pouvez créer un compte avant de configurer un téléphone.');
    message.textContent = accountCopy(configuredDevices().length
      ? ''
      : 'Aucun appareil Android configuré. Vous pouvez quand même créer des comptes.');
  } catch (error) {
    if (generation !== accountLoad) return;
    closeAccountLink();
    list.after($('pairForm'));
    list.replaceChildren();
    message.textContent = accountCopy(['PGRST202', 'PGRST205', '42P01', '42703'].includes(error.code)
      ? 'La gestion des comptes doit être activée dans Supabase. Les autres outils restent accessibles.'
      : 'Impossible de charger les comptes. Réessayez.');
  } finally {
    if (generation === accountLoad) {
      $('refreshAccounts').disabled = false;
      resizeParent();
    }
  }
}
$('refreshAccounts').onclick = () => void loadAppAccounts();
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
  const labels={update:'Nouvelle version signalée',current:'Même code de version que le catalogue',older:'Version Play inférieure au catalogue',prepare:'Première version à préparer',unconfirmed:'Version à confirmer dans l’APK',error:'Vérification impossible',skipped:'Sans fiche Google Play'};
  detail.append(text('span',labels[result.kind],'pill '+(result.kind==='current'?'approved':'pending')));
  if(result.kind==='error'||result.kind==='skipped')detail.append(text('p',result.message));
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
$('loginForm').onsubmit=e=>{e.preventDefault();task(e.submitter,async()=>{check(await db.auth.signInWithPassword({email:$('email').value,password:$('password').value}));$('password').value='';await load();});};
$('refresh').onclick=e=>task(e.currentTarget,load);$('viewRefresh').onclick=e=>task(e.currentTarget,load);$('catalogSearch').oninput=renderCatalog;$('requestSearch').oninput=renderRequests;$('requestFilter').onchange=renderRequests;
$('createAccountForm').onsubmit = event => {
  event.preventDefault();
  const action = $('createAccount');
  if (action.disabled || !currentUser) return;
  const userId = currentUser.id;
  return task(action, async () => {
    check(await db.rpc('yd_admin_create_app_account', {
      contact_email: $('pairEmail').value.trim(),
      contact_phone: $('pairPhone').value.trim().replace(/[\s().-]/g, '')
    }));
    if (currentUser?.id !== userId || view !== 'pair') return;
    event.target.reset();
    await loadAppAccounts();
    status('Compte créé. Vous pourrez lui associer un appareil à tout moment.');
  });
};

$('pairForm').onsubmit = event => {
  event.preventDefault();
  const action = $('pair');
  if (action.disabled || !currentUser || !linkAccount) return;
  const userId = currentUser.id;
  const account = linkAccount;
  const generation = linkGeneration;
  const target = $('devices').value.trim().toLowerCase();
  if (!isDeviceId(target) || !configuredDevices().some(device => device.id === target)) {
    status('Choisissez l’identifiant d’un appareil Android configuré dans votre espace.', true);
    return;
  }
  return task(action, async () => {
    clearAccountCode();
    const result = check(await db.rpc('yd_admin_assign_app_account', { account_id: account, target_device: target }));
    const expires = Date.parse(result?.expires_at);
    if (!/^[0-9a-f]{32}$/i.test(result?.code || '') || !(expires > Date.now()) ||
        result.device_id !== target || result.account_id !== account) {
      throw new Error(accountCopy('Impossible de créer le code. Réessayez.'));
    }
    if (currentUser?.id !== userId || view !== 'pair' || linkGeneration !== generation) return;
    $('pairCode').textContent = result.code;
    $('pairResult').hidden = false;
    codeExpiryTimer = setTimeout(() => {
      clearAccountCode();
      status('Le code a expiré. Créez-en un nouveau si nécessaire.');
      void loadAppAccounts();
    }, Math.max(0, expires - Date.now()));
    status('');
    await loadAppAccounts();
  });
};

function clearAccountCode() {
  if (codeExpiryTimer) clearTimeout(codeExpiryTimer);
  codeExpiryTimer = null;
  $('pairResult').hidden = true;
  $('pairCode').textContent = '';
}

$('devices').oninput = () => {
  linkGeneration++;
  clearAccountCode();
};
$('cancelPair').onclick = () => closeAccountLink()?.focus();
$('copyCode').onclick = event => task(event.currentTarget, async () => {
  const code = $('pairCode').textContent;
  if (!code) return;
  await navigator.clipboard.writeText(code);
  status('Code copié.');
});
$('importPlay').onclick=e=>task(e.currentTarget,async()=>{const headers=await ownerHeaders();const pkg=parsePlayUrl($('playUrl').value);form.elements.package_name.value=pkg;form.elements.source_url.value='https://play.google.com/store/apps/details?id='+encodeURIComponent(pkg);const preset=BASE_APPS.find(a=>a.package_name===pkg);if(preset){form.elements.name.value=preset.name;form.elements.description.value=preset.description;form.elements.is_base.checked=isOwner;}let response;try{response=await fetch(GPLAY_API+'/api/info/'+encodeURIComponent(pkg),{headers,cache:'no-store',redirect:'error'});}catch(_){throw Error('Le service local ne répond pas. Démarrez-le selon le guide « Configurer le service ».');}const info=await response.json();if(!response.ok||info.error)throw Error(info.error||'Impossible de lire la fiche Google Play.');if(info.title&&info.title!==pkg)form.elements.name.value=info.title;if(info.developer&&info.developer!=='Unknown')form.elements.description.value='Éditeur : '+info.developer;status('Fiche Google Play reconnue. Cliquez sur « Télécharger l’APK » pour la préparer.');});
$('downloadPlay').onclick=e=>task(e.currentTarget,async()=>{const headers=await ownerHeaders();const pkg=parsePlayUrl($('playUrl').value);form.elements.package_name.value=pkg;form.elements.source_url.value='https://play.google.com/store/apps/details?id='+encodeURIComponent(pkg);$('apkInfo').textContent='Téléchargement depuis Google Play…';let response;try{response=await fetch(GPLAY_API+'/api/download-merged/'+encodeURIComponent(pkg)+'?arch=arm64-v8a',{headers,cache:'no-store',redirect:'error'});}catch(_){throw Error('Le service Google Play local est introuvable. Consultez le guide de démarrage ci-dessous.');}const type=response.headers.get('content-type')||'';if(!response.ok||type.includes('application/json')){let detail='Téléchargement impossible. Vérifiez la connexion au service Google Play.';try{const payload=await response.json();detail=payload.error||detail;}catch(_){}throw Error(detail);}const blob=await response.blob();if(!blob.size)throw Error('Le service a renvoyé un fichier APK vide.');const file=new File([blob],pkg+'.apk',{type:'application/vnd.android.package-archive'});const metadata=await inspectApk(file);if(metadata.package_name!==pkg)throw Error('Le paquet de l’APK reçu ne correspond pas au lien Google Play.');uploaded={file,...metadata};for(const k of['package_name','version_code','version_name','sha256'])form.elements[k].value=metadata[k];if(!form.elements.name.value||form.elements.name.value===pkg)form.elements.name.value=BASE_APPS.find(a=>a.package_name===pkg)?.name||pkg;form.elements.apk_url.value='';$('apkInfo').textContent=`APK récupéré · version ${metadata.version_name} · ${(file.size/1048576).toFixed(1)} Mo · empreinte vérifiée. Vérifiez les avertissements avant publication.`;status('APK prêt. Vérifiez les informations, puis publiez-le dans la boutique YiDream.');});
$('apkFile').onchange=e=>task(null,async()=>{uploaded=null;await ownerHeaders();const file=e.target.files?.[0];if(!file)return;$('apkInfo').textContent='Lecture du fichier APK…';const metadata=await inspectApk(file);uploaded={file,...metadata};for(const k of['package_name','version_code','version_name','sha256'])form.elements[k].value=metadata[k];const preset=BASE_APPS.find(a=>a.package_name===metadata.package_name);if(preset&&!form.elements.name.value){form.elements.name.value=preset.name;form.elements.description.value=preset.description;form.elements.source_url.value=preset.source_url;}form.elements.apk_url.value='';$('apkInfo').textContent=`${metadata.package_name} · version ${metadata.version_name} · ${(file.size/1048576).toFixed(1)} Mo · fichier vérifié`;});
form.onsubmit=e=>{e.preventDefault();task(e.submitter,async()=>{const values=Object.fromEntries(new FormData(form));values.is_base=isOwner&&form.elements.is_base.checked;values.version_code=values.version_code?Number(values.version_code):null;for(const k of['apk_url','sha256','version_name','source_url'])values[k]=values[k]?.trim()||null;if(values.source_url)parsePlayUrl(values.source_url);let newPath=null;try{if(uploaded){await ownerHeaders();newPath=`${isOwner?(form.dataset.ownerId||currentUser.id):currentUser.id}/${uploaded.package_name}/${uploaded.sha256}.apk`;check(await db.storage.from('yd-apks').upload(newPath,uploaded.file,{contentType:'application/vnd.android.package-archive',upsert:true}));values.apk_url=`https://jqrznghqwdjbizjehzrm.supabase.co/storage/v1/object/authenticated/yd-apks/${newPath}`;values.storage_path=newPath;}else if(values.apk_url){const u=new URL(values.apk_url);if(u.protocol!=='https:'||u.username||u.password)throw Error('Utilisez un lien HTTPS sans identifiants.');}if(values.apk_url&&!releaseReady(values))throw Error('Le paquet, le code de version et le SHA-256 sont nécessaires pour publier un APK.');if(!uploaded&&form.dataset.editId){const previous=catalog.find(a=>a.id===form.dataset.editId);if(previous&&values.apk_url!==previous.apk_url)values.storage_path=null;}if(form.dataset.editId){check(await db.from('yd_catalog').update({...values,enabled:catalog.find(app=>app.id===form.dataset.editId)?.enabled??true}).eq('id',form.dataset.editId));}else{check(await db.from('yd_catalog').upsert({...values,owner_id:currentUser.id,enabled:true},{onConflict:'owner_id,package_name'}));}form.reset();delete form.dataset.editId;delete form.dataset.ownerId;uploaded=null;$('apkInfo').textContent='Le nom du paquet, la version et l’empreinte sont lus dans le fichier APK.';$('catalogEditor').close();await load();status('Application enregistrée dans la boutique.');}catch(error){if(newPath)status('Le fichier APK est envoyé, mais sa publication a échoué. Réessayez.',true);throw error;}});};
db.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') {
    currentUser = null;
    resetAppAccounts();
    $('workspace').hidden = true;
    hidePlayUpdates();
  }
  if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') setTimeout(() => task(null, load), 0);
});
await task(null,load);
