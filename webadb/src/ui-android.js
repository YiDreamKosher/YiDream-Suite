import { fetchCurrentApk } from './current-apk.js';
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
function rerender() { if (current) renderAndroid(current.c, current.s); }

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
    const groupMarkup = Object.entries(appCatalog).map(([name,items],index) => '<details class="app-filter-group" '+(index===0?'open':'')+'><summary><span>'+esc(name)+'</span><small>'+items.filter(([,pkg])=>b.packages.has(pkg)).length+' / '+items.length+' sélectionnées</small></summary><div class="app-filter-actions"><button type="button" class="ghost" data-select-group="'+index+'">Tout sélectionner</button><button type="button" class="ghost" data-clear-group="'+index+'">Tout désélectionner</button></div><div class="app-filter-list">'+packageRows(items)+'</div></details>').join('');
    c.innerHTML = `${head(t('blocking_title'), 'Choisissez les applications précises à masquer sur l’appareil.', 3)}<div class="app-filter-layout"><section class="panel app-filter-panel"><div class="app-filter-toolbar"><div><h4>Applications à bloquer</h4><p class="small">Les applications absentes de l’appareil sont ignorées. Les choix décochés auparavant seront réautorisés.</p></div><input type="search" id="filterSearch" placeholder="Rechercher une application ou un identifiant…" aria-label="Rechercher une application"></div>${groupMarkup}</section><aside class="panel app-filter-side"><div class="field"><label for="cExtra">Autres applications (identifiants Android)</label><input type="text" id="cExtra" placeholder="com.exemple.application, org.exemple.app" value="${esc(b.extra)}"></div><p class="small">Identifiants séparés par des virgules. L’identifiant exact figure généralement dans la fiche de l’application.</p><div class="app-filter-summary"><b id="selectedFilterCount">${b.packages.size}</b><span>applications sélectionnées</span></div><div class="notice">Les applications de messagerie ne sont pas présélectionnées. Android masque l’application choisie sans la désinstaller.</div></aside></div>`;
    const updateCount=()=>{const n=c.querySelector('#selectedFilterCount');if(n)n.textContent=String(b.packages.size);c.querySelectorAll('.app-filter-group').forEach((el,i)=>{const items=Object.values(appCatalog)[i];el.querySelector('summary small').textContent=items.filter(([,pkg])=>b.packages.has(pkg)).length+' / '+items.length+' sélectionnées'})};
    c.querySelectorAll('[data-filter-package]').forEach(input=>input.onchange=()=>{if(input.checked)b.packages.add(input.dataset.filterPackage);else b.packages.delete(input.dataset.filterPackage);updateCount()});
    c.querySelectorAll('[data-select-group]').forEach(btn=>btn.onclick=()=>{Object.values(appCatalog)[Number(btn.dataset.selectGroup)].forEach(([,pkg])=>b.packages.add(pkg));renderAndroid(c,'Configuration')});
    c.querySelectorAll('[data-clear-group]').forEach(btn=>btn.onclick=()=>{Object.values(appCatalog)[Number(btn.dataset.clearGroup)].forEach(([,pkg])=>b.packages.delete(pkg));renderAndroid(c,'Configuration')});
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
