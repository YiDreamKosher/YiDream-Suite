import { fetchCurrentApk } from './current-apk.js';
import { preparePhone, phoneConfiguration } from './android-setup.js';
// YiDream v1.2 — interface de YiDream Android (configurateur Web ADB) branchée sur la vraie logique.
import { YiDreamAdb, parseExtraPackages } from './adb.js';
import { CONFIG } from './config.js';
import { UI_STRINGS } from './i18n.js';

const appCatalog = {
  'Navigateurs internet': [['Chrome','com.android.chrome'],['Chrome Beta','com.chrome.beta'],['Firefox','org.mozilla.firefox'],['Samsung Internet','com.sec.android.app.sbrowser'],['Opera','com.opera.browser'],['Opera Mini','com.opera.mini.native'],['Microsoft Edge','com.microsoft.emmx'],['Brave','com.brave.browser'],['DuckDuckGo','com.duckduckgo.mobile.android'],['UC Browser','com.UCMobile.intl'],['Kiwi Browser','com.kiwiz.browser'],['Vivaldi','com.vivaldi.browser'],['Navigateur Android','com.android.browser']],
  'Assistants IA': [['ChatGPT','com.openai.chatgpt'],['Gemini','com.google.android.apps.bard'],['Google AI','com.google.android.apps.aichat'],['Microsoft Copilot','com.microsoft.copilot'],['Claude','com.anthropic.claude'],['Perplexity','ai.perplexity.app.android'],['DeepSeek','com.deepseek.chat'],['Grok','com.x.grok'],['Character.AI','com.character.ai']],
  'Réseaux sociaux': [['Instagram','com.instagram.android'],['TikTok','com.zhiliaoapp.musically'],['Facebook','com.facebook.katana'],['Snapchat','com.snapchat.android'],['X','com.twitter.android'],['Reddit','com.reddit.frontpage']],
  'Boutique d’applications': [['Google Play Store','com.android.vending']]
};
const defaultBlockedPackages = new Set(Object.values(appCatalog).flat().map(([,pkg]) => pkg));

const client = new YiDreamAdb();
const state = { blocking: { browsers: true, ai: true, social: true, store: true, extra: '', packages: new Set(defaultBlockedPackages) }, bundledApk: null };

const lang = () => (window.getLang ? window.getLang() : 'en');
const t = (k) => UI_STRINGS[lang()]?.[k] ?? UI_STRINGS.en[k] ?? k;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (id) => document.getElementById(id);
const toast = (m) => window.toast && window.toast(m);

// ---- Journal (onglet Logs + boîte de log en direct) ----
function log(step, event) {
  const entry = { time: new Date().toLocaleTimeString(), step, event };
  (window.adbLogs ||= []).push(entry);
  const box = $('logBox');
  if (box) { box.textContent += `[${entry.time}] ${event}\n`; box.scrollTop = box.scrollHeight; }
}
const errText = (e) => {
  const m = e && e.message ? e.message : String(e);
  if (m === 'UNSUPPORTED') return t('unsupported');
  if (m === 'NO_DEVICE') return t('log_no_device');
  if (m === 'NOT_CONNECTED') return t('log_connect_first');
  if (/get_android_unlock_material|schema cache/i.test(m)) return 'La fonction Android manque dans Supabase. Exécutez webadb/supabase/migrations/20261008000000_android_admin_unlock_key.sql dans SQL Editor, puis rechargez la page.';
  return m;
};
const fail = (step, e) => { console.error(e); log(step, '❌ ' + errText(e)); toast(errText(e).split('\n')[0]); };
const logBox = () => '<div class="log-box" id="logBox"></div>';

client.onDisconnect = () => { log('Connection', t('log_disconnected')); rerender(); };

let current = null;
function rerender() { if (current?.c.isConnected) { if (current.s === 'guided') renderAndroidWizard(current.c); else renderAndroid(current.c, current.s); } }

// ---- Blocs communs ----
function devicePanel() {
  const i = client.info;
  if (!i) return `<div class="device-row"><div class="phone">📱</div><div><b>${esc(t('device_none'))}</b><br><span class="small">${esc(t('device_none_sub'))}</span></div></div>`;
  return `<div class="device-row"><div class="phone">📱</div><div><b>${esc(i.manufacturer)} ${esc(i.model)}</b><br><span class="small">Android ${esc(i.android)} · SDK ${esc(i.sdk)}<br>${esc(i.serial)}</span></div></div><br><button class="ghost" id="btnDisc">${esc(t('disconnect'))}</button>`;
}
const stepper = (n) => ['1 · Connect|Connect your phone', '2 · Install|Install YiDream', '3 · Device Owner|Activate management', '4 · Configure|Apply the filter']
  .map((x, i) => { const [a, b] = x.split('|'); return `<div class="step ${i === n ? 'active' : ''}"><b>${a}</b>${b}</div>`; }).join('');
const head = (title, sub, n) => `<h2>${esc(title)}</h2><div class="sub">${esc(sub)}</div>${n != null ? `<div class="stepper">${stepper(n)}</div>` : ''}`;
const needDevice = () => { if (!client.info) { toast(t('log_connect_first')); return false; } return true; };

// ---- Sections ----
const sections = {
  Connect(c) {
    c.innerHTML = `${head(t('connect_title'), t('connect_subtitle'), 0)}
      <div class="android-config">
        <div class="panel"><h4>Web ADB</h4>
          <div class="status-pill ${client.info ? 'ok' : 'no'}">${esc(client.info ? t('connect_connected') : t('connect_disconnected'))}</div><br><br>
          <button class="primary" id="btnConnect">${esc(t('connect_button'))}</button>
          <div class="small" style="margin-top:10px">Chrome / Edge · WebUSB · USB</div></div>
        <div class="panel"><h4>${esc(t('connect_connected').replace('✅ ', ''))}</h4>${devicePanel()}</div>
      </div>
      <div class="notice"><b>${esc(t('usb_help_title'))}</b><br>${esc(t('usb_help'))}</div>${logBox()}`;
    $('btnConnect').onclick = async () => {
      if (!YiDreamAdb.supported) { toast(t('unsupported')); return; }
      try {
        await client.connect((s) => log('Connection', t({ searching: 'log_searching_device', connecting: 'log_connecting', authenticating: 'log_authenticating' }[s])));
        log('Connection', t('log_connected') + client.info.serial);
        rerender();
      } catch (e) { fail('Connection', e); }
    };
    const d = $('btnDisc'); if (d) d.onclick = async () => { await client.disconnect(); log('Connection', t('log_disconnected')); rerender(); };
  },

  'Install YiDream'(c) {
    c.innerHTML = `${head(t('install_title'), t('install_subtitle'), 1)}
      <div class="panel"><h4>YiDream Android</h4>
        <div class="status-pill no" id="apkPill">${esc(t('install_searching'))}</div><br>
        <button class="primary" id="btnInstall" disabled>${esc(t('install_button'))}</button>
        <button class="ghost" id="btnCheck">${esc(t('install_check'))}</button>
        <div class="small" id="installStatus" style="margin-top:10px"></div>
        <div class="small" style="margin-top:14px"><a href="#" id="apkAdvancedLink" style="color:var(--muted)">${esc(t('install_advanced_toggle'))}</a></div>
        <div id="apkAdvanced" style="display:none;margin-top:10px" class="field"><label>${esc(t('install_manual_label'))}</label><input type="file" id="apkInput" accept=".apk"></div>
      </div>${logBox()}`;
    const setPill = (ok, text) => { const pill = $('apkPill'); if (pill) { pill.className = 'status-pill ' + (ok ? 'ok' : 'no'); pill.textContent = text; } };
    const refreshSource = () => {
      // Ces éléments peuvent avoir disparu si l'utilisateur a changé de section
      // pendant que la détection automatique de l'APK était encore en cours.
      const btn = $('btnInstall');
      const input = $('apkInput');
      if (!btn || !input) return;
      const manual = input.files[0];
      state.selectedApk = manual || state.bundledApk || null;
      btn.disabled = !state.selectedApk || !client.info;
      if (manual) setPill(true, `${t('log_apk_found')} · ${manual.name} (${(manual.size / 1048576).toFixed(1)} Mo)`);
      else if (state.bundledApk) setPill(true, `${t('log_apk_found')} · ${state.apkVersion || ''} (${(state.bundledApk.size / 1048576).toFixed(1)} Mo)`);
      else setPill(false, t('log_apk_not_found'));
    };
    (async () => {
      try {
        const release = await fetchCurrentApk();
        state.bundledApk = release.blob;
        state.apkVersion = release.versionName;
      } catch { state.bundledApk = null; }
      refreshSource();
    })();
    $('apkAdvancedLink').onclick = (e) => {
      e.preventDefault();
      const box = $('apkAdvanced');
      box.style.display = box.style.display === 'none' ? 'block' : 'none';
    };
    $('apkInput').onchange = refreshSource;
    $('btnInstall').onclick = async () => {
      if (!client.info) { toast(t('log_connect_and_apk')); return; }
      const src = state.selectedApk;
      if (!src) { toast(t('log_connect_and_apk')); return; }
      try {
        log('Installation', `${t('log_installing')} (${(src.size / 1048576).toFixed(1)} Mo)`);
        await client.installApk(src);
        log('Installation', t('log_apk_installed')); toast(t('log_apk_installed'));
      } catch (e) { fail('Installation', e); }
    };
    $('btnCheck').onclick = async () => {
      if (!needDevice()) return;
      try { $('installStatus').textContent = (await client.isInstalled()) ? t('install_installed') : t('install_missing'); } catch (e) { fail('Installation', e); }
    };
  },

  'Device Owner'(c) {
    c.innerHTML = `${head(t('owner_title'), t('owner_subtitle'), 2)}
      <div class="panel"><h4>Device Owner</h4><button class="primary" id="btnOwner">${esc(t('owner_button'))}</button></div>${logBox()}`;
    $('btnOwner').onclick = async () => {
      if (!needDevice()) return;
      try {
        log('Device Owner', t('log_activating_owner'));
        const r = await client.setDeviceOwner();
        if (YiDreamAdb.ok(r)) { log('Device Owner', t('log_owner_activated')); toast(t('log_owner_activated')); }
        else { log('Device Owner', '❌ ' + r.out); log('Device Owner', t('no_owner_hint')); toast(t('no_owner_hint').split(':')[0]); }
      } catch (e) { fail('Device Owner', e); }
    };
  },

  Configuration(c) {
    const b = state.blocking;
    const packageRows = (items) => items.map(([name,pkg]) => '<label class="app-filter-row"><input type="checkbox" data-filter-package="'+esc(pkg)+'" '+(b.packages.has(pkg)?'checked':'')+'><span><b>'+esc(name)+'</b><small>'+esc(pkg)+'</small></span></label>').join('');
    const groupMarkup = Object.entries(appCatalog).map(([name,items],index) => '<details class="app-filter-group" '+(index===0?'open':'')+'><summary><span>'+esc(name)+'</span><small>'+items.filter(([,pkg])=>b.packages.has(pkg)).length+' / '+items.length+' sélectionnées</small></summary><div class="app-filter-actions"><label><input type="checkbox" data-filter-group="'+index+'" '+(items.every(([,pkg])=>b.packages.has(pkg))?'checked':'')+'> Toute la catégorie</label></div><div class="app-filter-list">'+packageRows(items)+'</div></details>').join('');
    c.innerHTML = `${head(t('blocking_title'), 'Choisissez les applications précises à masquer sur l’appareil.', 3)}<div class="app-filter-layout"><section class="panel app-filter-panel"><div class="app-filter-toolbar"><div><h4>Applications à bloquer</h4><p class="small">Les applications absentes de l’appareil sont ignorées. Les choix décochés auparavant seront réautorisés.</p></div><input type="search" id="filterSearch" placeholder="Rechercher une application ou un identifiant…" aria-label="Rechercher une application"></div>${groupMarkup}</section><aside class="panel app-filter-side"><div class="field"><label for="cExtra">Autres applications (identifiants Android)</label><input type="text" id="cExtra" placeholder="com.exemple.application, org.exemple.app" value="${esc(b.extra)}"></div><p class="small">Identifiants séparés par des virgules. L’identifiant exact figure généralement dans la fiche de l’application.</p><div class="app-filter-summary"><b id="selectedFilterCount">${b.packages.size}</b><span>applications sélectionnées</span></div><div class="notice">Les applications de messagerie ne sont pas présélectionnées. Android masque l’application choisie sans la désinstaller.</div></aside></div>`;
    const updateCount=()=>{const n=c.querySelector('#selectedFilterCount');if(n)n.textContent=String(b.packages.size);c.querySelectorAll('.app-filter-group').forEach((el,i)=>{const items=Object.values(appCatalog)[i];const groupInput=el.querySelector('[data-filter-group]');groupInput.checked=items.every(([,pkg])=>b.packages.has(pkg));groupInput.indeterminate=items.some(([,pkg])=>b.packages.has(pkg))&&!groupInput.checked;el.querySelector('summary small').textContent=items.filter(([,pkg])=>b.packages.has(pkg)).length+' / '+items.length+' sélectionnées'})};
    c.querySelectorAll('[data-filter-package]').forEach(input=>input.onchange=()=>{if(input.checked)b.packages.add(input.dataset.filterPackage);else b.packages.delete(input.dataset.filterPackage);updateCount()});
    c.querySelectorAll('[data-filter-group]').forEach(input=>input.onchange=()=>{Object.values(appCatalog)[Number(input.dataset.filterGroup)].forEach(([,pkg])=>{if(input.checked)b.packages.add(pkg);else b.packages.delete(pkg)});rerender()});
    c.querySelector('#filterSearch').oninput=e=>{const q=e.target.value.trim().toLocaleLowerCase();c.querySelectorAll('.app-filter-group').forEach(group=>{let visible=0;group.querySelectorAll('.app-filter-row').forEach(row=>{row.hidden=!!q&&!row.textContent.toLocaleLowerCase().includes(q);if(!row.hidden)visible++});group.hidden=!!q&&!visible;if(q&&visible)group.open=true})};
    $('cExtra').oninput=e=>{b.extra=e.target.value};
  },

  'Unlock & Apply'(c) {
    c.innerHTML = `${head(t('admin_title'), t('admin_subtitle'))}
      <div class="panel unlock-panel">
        <div class="unlock-intro"><span class="unlock-badge">🔐</span><div><h4>Code de déverrouillage</h4><p>Réservé aux administrateurs approuvés. Le code change chaque jour.</p></div></div>
        <button class="primary" id="btnCode">${esc(t('admin_generate_code'))}</button>
        <div id="codeOut" aria-live="polite"></div>
      </div>
      <div class="panel apply-panel"><div><h4>Appliquer la configuration</h4><p class="small">Le code sécurisé est ajouté au téléphone pendant cette étape.</p></div><button class="primary" id="btnApply">${esc(t('admin_apply'))}</button></div>
      ${logBox()}`;
    $('btnCode').onclick = async () => {
      const button = $('btnCode');
      button.disabled = true;
      try {
        const material = await window.getAndroidUnlockMaterial();
        $('codeOut').innerHTML = `<div class="code-display" aria-label="Code du jour">${esc(material.code)}</div><div class="small">Valable aujourd’hui · renouvelé automatiquement demain</div>`;
      } catch (e) { fail('Code de déverrouillage', e); }
      finally { button.disabled = false; }
    };
    $('btnApply').onclick = async () => {
      if (!needDevice()) return;
      const button = $('btnApply');
      button.disabled = true;
      try {
        const b = state.blocking;
        const extra = parseExtraPackages(b.extra);
        if (extra.invalid.length) log('Configuration', t('extra_invalid') + extra.invalid.join(', '));
        const material = await window.getAndroidUnlockMaterial();
        const config = {
          block_browsers: false,
          block_ai: false,
          block_social: false,
          block_store: false,
          extra_packages: [...new Set([...b.packages, ...extra.valid])],
          unlock_intermediate_key: material.intermediate_key
        };
        await client.applyConfig(config, (s) => log('Configuration', t({ launching: 'log_launching_app', sending: 'log_sending_config', relaunching: 'log_relaunching' }[s])));
        log('Configuration', t('log_config_applied')); toast(t('log_config_applied'));
      } catch (e) { fail('Configuration', e); }
      finally { button.disabled = false; }
    };
  },

  Advanced(c) {
    c.innerHTML = `${head(t('advanced_title'), t('advanced_subtitle'))}
      <div class="panel"><button class="ghost" id="btnClear">${esc(t('advanced_clear'))}</button> <button class="ghost danger" id="btnUninstall">${esc(t('advanced_uninstall'))}</button></div>${logBox()}`;
    $('btnClear').onclick = async () => {
      if (!needDevice() || !confirm(t('confirm_clear'))) return;
      try {
        log('Advanced', t('log_removing_owner'));
        const r = await client.removeAdmin();
        log('Advanced', YiDreamAdb.ok(r) ? t('log_restrictions_removed') : '❌ ' + r.out);
      } catch (e) { fail('Advanced', e); }
    };
    $('btnUninstall').onclick = async () => {
      if (!needDevice() || !confirm(t('confirm_uninstall'))) return;
      try {
        log('Advanced', t('log_uninstalling'));
        const r = await client.uninstall();
        log('Advanced', YiDreamAdb.ok(r) ? t('log_uninstalled') : '❌ ' + r.out);
      } catch (e) { fail('Advanced', e); }
    };
  },

  Settings(c) {
    c.innerHTML = `<h2>Android Settings</h2><div class="sub">${esc(t('section_settings'))}</div>
      <div class="panel"><div class="field"><label>Browser connection</label><select><option>Web ADB / WebUSB</option></select></div>
      <br><div class="small">Config path: ${esc(CONFIG.configRemotePath)}</div></div>`;
  },
};

export function renderAndroid(c, name) {
  current = { c, s: name };
  (sections[name] || sections.Connect)(c);
  const d = $('btnDisc'); if (d && !d.onclick) d.onclick = async () => { await client.disconnect(); rerender(); };
}

export const androidNav = ['Connect', 'Install YiDream', 'Device Owner', 'Configuration', 'Unlock & Apply', 'Advanced', 'Logs', 'Settings'];

// Guided entry used by the administration console; the standalone tools remain available.
const guided = { step: 0, busy: false, preparedSerial: null, error: '', progress: '', done: false };
let guidedHost = null;
const wizardCopy = {
  fr: ['Connecter','Préparer','Choisir le filtre','Appliquer','Configurer un téléphone','Quatre étapes pour préparer votre Android.','Branchez le téléphone en USB et autorisez le débogage USB dans ses réglages.','Connecter le téléphone','Installer YiDream et activer sa gestion en une seule étape. Gardez le téléphone branché.','Préparer le téléphone','Choisissez les applications à masquer. Vous pourrez ajuster ces choix ensuite.','Continuer','Vérifiez le téléphone et les applications sélectionnées, puis lancez la configuration.','Appliquer le filtre','Retour','Téléphone configuré','La configuration a été envoyée au téléphone. Ouvrez YiDream sur celui-ci pour vérifier le résultat.','Configurer un autre téléphone','Détails techniques','Installation de YiDream…','Activation de la gestion…','Envoi de la configuration…','Veuillez patienter…','Applications à masquer','Aide pour la connexion','Chrome ou Edge est nécessaire. Déverrouillez le téléphone et acceptez la demande d’autorisation USB.','Un problème ?','Si l’activation échoue, retirez les comptes personnels dans les réglages Android puis réessayez. Ne réinitialisez pas le téléphone sans sauvegarde.','Options du téléphone','Déconnecter','La préparation peut installer ou mettre à jour YiDream et activer la gestion de cet appareil.'],
  en: ['Connect','Prepare','Choose filter','Apply','Set up a phone','Four steps to prepare your Android.','Connect the phone by USB and enable USB debugging in its settings.','Connect phone','Install YiDream and activate management in one step. Keep the phone connected.','Prepare phone','Choose the apps to hide. You can adjust your choices later.','Continue','Review the phone and selected apps, then apply the configuration.','Apply filter','Back','Phone configured','The configuration was sent to the phone. Open YiDream on it to check the result.','Set up another phone','Technical details','Installing YiDream…','Activating management…','Sending configuration…','Please wait…','Apps to hide','Connection help','Chrome or Edge is required. Unlock the phone and accept the USB authorization request.','Need help?','If activation fails, remove personal accounts in Android settings and retry. Do not reset the phone without a backup.','Phone options','Disconnect','Preparation may install or update YiDream and enable device management.'],
  he: ['חיבור','הכנה','בחירת סינון','החלה','הגדרת טלפון','ארבעה שלבים להכנת מכשיר Android.','חברו את הטלפון ב־USB והפעילו ניפוי באגים ב־USB בהגדרות.','חיבור הטלפון','התקנת YiDream והפעלת הניהול בשלב אחד. השאירו את הטלפון מחובר.','הכנת הטלפון','בחרו אילו יישומים להסתיר. ניתן לשנות את הבחירה בהמשך.','המשך','בדקו את הטלפון והיישומים שנבחרו ולאחר מכן החילו את ההגדרות.','החלת הסינון','חזרה','הטלפון הוגדר','ההגדרות נשלחו לטלפון. פתחו את YiDream בטלפון כדי לבדוק את התוצאה.','הגדרת טלפון נוסף','פרטים טכניים','מתקין YiDream…','מפעיל ניהול…','שולח הגדרות…','נא להמתין…','יישומים להסתרה','עזרה בחיבור','נדרש Chrome או Edge. פתחו את נעילת הטלפון ואשרו את בקשת ה־USB.','צריכים עזרה?','אם ההפעלה נכשלת, הסירו חשבונות אישיים בהגדרות Android ונסו שוב. אין לאפס ללא גיבוי.','אפשרויות הטלפון','ניתוק','ההכנה עשויה להתקין או לעדכן YiDream ולהפעיל ניהול מכשיר.'],
  yi: ['פֿאַרבינדן','צוגרייטן','אויסקלײַבן פֿילטער','אָנווענדן','איינשטעלן אַ טעלעפֿאָן','פֿיר שריט צו צוגרייטן אייער Android.','פֿאַרבינדט דעם טעלעפֿאָן מיט USB און אַקטיווירט USB debugging אין די סעטינגס.','פֿאַרבינדן טעלעפֿאָן','ינסטאַלירט YiDream און אַקטיווירט די פאַרוואַלטונג אין איין שריט. לאָזט דעם טעלעפֿאָן פֿאַרבונדן.','צוגרייטן טעלעפֿאָן','קלײַבט אויס וועלכע אַפּס צו באַהאַלטן. איר קענט שפּעטער ענדערן די ברירה.','ווײַטער','קוקט איבער דעם טעלעפֿאָן און די אויסגעקליבענע אַפּס, דערנאָך שיקט די סעטינגס.','אָנווענדן פֿילטער','צוריק','טעלעפֿאָן איינגעשטעלט','די סעטינגס זענען געשיקט געוואָרן. עפֿנט YiDream אויפֿן טעלעפֿאָן צו קאָנטראָלירן דעם רעזולטאַט.','איינשטעלן נאָך אַ טעלעפֿאָן','טעכנישע פּרטים','ינסטאַלירט YiDream…','אַקטיווירט פאַרוואַלטונג…','שיקט סעטינגס…','ביטע וואַרט…','אַפּס צו באַהאַלטן','הילף בײַם פֿאַרבינדן','Chrome אָדער Edge איז נייטיק. עפֿנט דעם טעלעפֿאָן און באַשטעטיקט דעם USB צוטריט.','דאַרפֿט הילף?','אויב אַקטיוואַציע דורכפֿאַלט, נעמט אַוועק פּערזענלעכע חשבונות אין Android און פּרובירט ווידער. מאַכט נישט קיין reset אָן אַ באַקאַפּ.','טעלעפֿאָן אָפּציעס','אָפּרײַסן','די צוגרייטונג קען אינסטאַלירן אָדער דערהײַנטיקן YiDream און אַקטיווירן די פאַרוואַלטונג.']
};
const w = i => (wizardCopy[lang()] || wizardCopy.fr)[i];

export function renderAndroidWizard(c) {
  guidedHost = c;
  current = { c, s: 'guided' };
  if (!client.info && guided.step > 0) { guided.step = 0; guided.preparedSerial = null; guided.done = false; }
  c.classList.add('android-guided');
  const redraw = () => { if (guidedHost?.isConnected) renderAndroidWizard(guidedHost); };
  const move = step => { guided.step = step; guided.error = ''; redraw(); };
  const phone = client.info;
  const phoneName = phone ? `${phone.manufacturer} ${phone.model}`.trim() : 'Android';
  const run = async action => {
    if (guided.busy) return;
    guided.busy = true; guided.error = ''; redraw();
    try { await action(); }
    catch (e) { guided.error = errText(e); log('Android', guided.error); }
    finally { guided.busy = false; guided.progress = ''; redraw(); }
  };
  const logs = (window.adbLogs || []).map(x => `[${x.time}] ${x.event}`).join('\n');
  const info = phone ? `<div class="setup-phone"><span class="setup-phone-icon" aria-hidden="true">▯</span><div><b>${esc(phoneName)}</b><small>Android ${esc(phone.android)} · ${esc(phone.serial)}</small></div><span class="setup-connected">USB</span></div>` : '';
  if (guided.done) {
    c.innerHTML = `<section class="setup-success"><span class="setup-success-mark" aria-hidden="true">✓</span><h2>${w(15)}</h2><p>${w(16)}</p>${info}<button class="primary" id="setupAnother">${w(17)}</button></section>`;
    $('setupAnother').onclick = () => run(async () => { await client.disconnect(); guided.step = 0; guided.preparedSerial = null; guided.done = false; });
    return;
  }
  c.innerHTML = `<div class="setup-heading"><span class="setup-eyebrow">ANDROID · USB</span><h2>${w(4)}</h2><p>${w(5)}</p></div><ol class="setup-progress" aria-label="${esc(w(4))}">${[0,1,2,3].map(i=>`<li ${i===guided.step?'aria-current="step"':''} class="${i<guided.step?'complete':''}"><span>${i<guided.step?'✓':i+1}</span><b>${w(i)}</b></li>`).join('')}</ol><section class="setup-card"><div class="setup-step-heading"><small>${guided.step+1} / 4</small><h3>${w(guided.step)}</h3><p>${w([6,8,10,12][guided.step])}</p></div>${info}<div id="setupBody"></div><p id="setupError" class="setup-error" role="alert" ${guided.error?'':'hidden'}>${esc(guided.error)}</p><p class="setup-status" role="status">${guided.busy?esc(guided.progress||w(22)):''}</p><div class="setup-footer">${guided.step?`<button class="ghost" id="setupBack" ${guided.busy?'disabled':''}>${w(14)}</button>`:'<span></span>'}<button class="primary" id="setupNext" ${guided.busy?'disabled':''}>${guided.busy?w(22):w([7,9,11,13][guided.step])}</button></div></section><details class="setup-details"><summary>${w(18)}</summary><button type="button" class="ghost" id="setupCode">${esc(t('admin_generate_code'))}</button><div id="setupCodeOut" aria-live="polite"></div><pre id="logBox" class="log-box">${esc(logs)}</pre></details>`;
  $('setupCode').disabled=guided.busy;
  $('setupCode').onclick=async()=>{const button=$('setupCode');button.disabled=true;try{const material=await window.getAndroidUnlockMaterial();const out=c.querySelector('#setupCodeOut');if(out)out.textContent=material.code;}catch(e){guided.error=errText(e);redraw();}finally{button.disabled=false;}};
  const body = $('setupBody');
  if (guided.step === 0) body.innerHTML = `<details class="setup-help"><summary>${w(24)}</summary><p>${w(25)}</p><p>${esc(t('usb_help'))}</p></details>`;
  if (guided.step === 1) body.innerHTML = `<p class="setup-note">${w(30)}</p><details class="setup-help"><summary>${w(26)}</summary><p>${w(27)}</p></details>`;
  if (guided.step === 2) {
    sections.Configuration(body);
    body.classList.add('setup-filter');
    body.querySelectorAll('.app-filter-group').forEach(group=>group.open=false);
    body.querySelector('.app-filter-side')?.classList.add('setup-filter-options');
    const side = body.querySelector('.app-filter-side');
    if (side) {
      const details = document.createElement('details');details.className='setup-help';
      const summary = document.createElement('summary');summary.textContent=lang()==='fr'?'Autres applications':lang()==='en'?'Other apps':lang()==='he'?'יישומים נוספים':'נאָך אַפּס';
      const field=side.querySelector('.field'),note=side.querySelector('p');
      details.append(summary);if(field)details.append(field);if(note)details.append(note);
      side.prepend(details);
    }
  }
  if (guided.step === 3) {
    const extra = parseExtraPackages(state.blocking.extra);
    const packages = new Set([...state.blocking.packages,...extra.valid]);
    body.innerHTML = `<div class="setup-review"><b>${packages.size}</b><span>${w(23)}</span></div><details class="setup-help"><summary>${w(23)}</summary><ul>${[...packages].map(pkg=>`<li>${esc(Object.values(appCatalog).flat().find(x=>x[1]===pkg)?.[0]||pkg)}</li>`).join('')}</ul></details>`;
  }
  $('setupBack')?.addEventListener('click',()=>move(guided.step-1));
  $('setupNext').onclick = () => {
    if (guided.step === 2) {
      const extra = parseExtraPackages(state.blocking.extra);
      if(extra.invalid.length){guided.error=t('extra_invalid')+extra.invalid.join(', ');redraw();return;}
      move(3);return;
    }
    run(async () => {
      if (guided.step === 0) {
        if (!YiDreamAdb.supported) throw new Error('UNSUPPORTED');
        if (!client.info) await client.connect(s=>{guided.progress=t({searching:'log_searching_device',connecting:'log_connecting',authenticating:'log_authenticating'}[s]);const status=c.querySelector('.setup-status');if(status)status.textContent=guided.progress;});
        guided.step = guided.preparedSerial===client.info.serial ? 2 : 1;
      } else if (guided.step === 1) {
        const release = await fetchCurrentApk();
        guided.preparedSerial = await preparePhone(client,release,phase=>{guided.progress=w(phase==='install'?19:20);const status=c.querySelector('.setup-status');if(status)status.textContent=guided.progress;});
        log('Android', t('log_owner_activated'));guided.step = 2;
      } else if (guided.step === 3) {
        if (!client.info || client.info.serial!==guided.preparedSerial) throw new Error('NOT_CONNECTED');
        const material=await window.getAndroidUnlockMaterial();
        if (!client.info || client.info.serial!==guided.preparedSerial) throw new Error('NOT_CONNECTED');
        const config=phoneConfiguration(state.blocking.packages,state.blocking.extra,material);
        guided.progress=w(21);const status=c.querySelector('.setup-status');if(status)status.textContent=guided.progress;
        await client.applyConfig(config,s=>log('Android',t({launching:'log_launching_app',sending:'log_sending_config',relaunching:'log_relaunching'}[s])));
        if (!client.info || client.info.serial!==guided.preparedSerial) throw new Error('NOT_CONNECTED');
        log('Android',t('log_config_applied'));guided.done=true;
      }
    });
  };
}
