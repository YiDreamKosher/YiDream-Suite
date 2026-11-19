import { deviceCopy } from './device-control-copy.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
const packageName = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const hostname = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const chromePackage = 'com.android.chrome';

export function normalizeRuleTarget(kind, input) {
  const value = input.trim();
  if (kind === 'app') return packageName.test(value) && value.length <= 255 ? value : null;
  if (kind !== 'site' || !value || value.includes('\\') || value.startsWith('/')) return null;
  try {
    const url = new URL(value.includes('://') ? value : 'https://' + value);
    const host = url.hostname.replace(/\.$/, '').toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        host.length > 253 || !hostname.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

export function normalizeSiteExpiry(localDateTime, now = Date.now()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localDateTime);
  if (!match) return null;
  const date = new Date(localDateTime);
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const timestamp = date.getTime();
  if (!(timestamp > now && timestamp <= now + 365 * 86_400_000) ||
      date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
      date.getHours() !== hour || date.getMinutes() !== minute) return null;
  return date.toISOString();
}

export function managedChromeControl(policy) {
  const chrome = policy.managed_chrome;
  if (!chrome) return { status: 'serviceMissing', toggle: null };
  const enabled = chrome.enabled === true;
  const current = Number.isSafeInteger(chrome.reported_revision) &&
    chrome.reported_revision === Number(policy.revision);
  const supported = chrome.status === 'ready' || chrome.status === 'active';
  const toggle = enabled ? false : supported ? true : null;
  if (current && chrome.status === 'failed') return { status: 'chromeFailed', toggle };
  if (chrome.status === 'unsupported') return { status: 'chromeUnsupported', toggle };
  if (enabled) {
    return { status: current && chrome.status === 'active' ? 'chromeActive' : 'chromePending', toggle };
  }
  if (!chrome.status) return { status: 'chromeUnreported', toggle };
  return { status: current && chrome.status === 'ready' ? 'chromeOff' : 'chromePending', toggle };
/** Profile defaults remain closed for MP3 until a boolean server exception arrives. */
export function deviceSections(policy) {
  const fallback = policy.device_profile !== 'mp3';
  return {
    webEnabled: typeof policy.web_enabled === 'boolean' ? policy.web_enabled : fallback,
    appStoreEnabled: typeof policy.app_store_enabled === 'boolean' ? policy.app_store_enabled : fallback
  };
}

export function mountDeviceControls(host, options) {
  const { device, devices = [], clients, language, packages, api } = options;
  const copy = key => deviceCopy(language, key);
  const eligibleClients = clients.filter(client => client.user_id === device.user_id);
  const controlsAvailable = device.platform === 'Android' && device.configuration_status === 'configured';
  const peers = devices.filter(candidate => candidate.platform === 'Android' &&
    candidate.configuration_status === 'configured' && candidate.user_id === device.user_id);
  const permissionOptions = `<option value="">${copy('keepPermission')}</option>
    <option value="on">${copy('enablePermission')}</option><option value="off">${copy('disablePermission')}</option>`;
  const assignedClient = eligibleClients.find(client => client.id === device.client_id);
  const clientFormMarkup = `<form class="device-client-form" data-client-form>
    <label>${copy('client')}<select name="client">
      <option value="">${copy('noClient')}</option>
      ${eligibleClients.map(client => `<option value="${escape(client.id)}"
        ${client.id === device.client_id ? 'selected' : ''}>${escape(client.name)}</option>`).join('')}
    </select></label>
    <button class="button" type="submit">${copy('saveClient')}</button>
    <p data-client-status role="status"></p>
  </form>`;
  host.innerHTML = `${controlsAvailable ? `<section class="device-rules" data-rules>
    <div class="device-rules-heading"><h3>${copy('deviceManager')}</h3>
      <button type="button" class="button" data-refresh-policy>${copy('refresh')}</button></div>
    <div class="device-policy-feedback">
      <p data-policy-status role="status" aria-live="polite"></p>
      <small data-policy-sync></small>
    </div>
    <p data-policy-error role="alert" hidden></p>
    <div class="device-chrome" data-managed-chrome hidden>
      <div>
        <h4>${copy('chromeTitle')}</h4>
        <p>${copy('chromeHint')}</p>
        <p data-chrome-status role="status"></p>
      </div>
      <button type="button" class="button" data-toggle-chrome hidden></button>
    </div>
    <div data-rule-list></div>
    <form data-rule-form class="device-rule-form" hidden>
      <label><span class="device-visually-hidden">${copy('target')}</span><select name="kind">
        <option value="site">${copy('site')}</option><option value="app">${copy('app')}</option>
      </select></label>
      <label><span class="device-visually-hidden">${copy('target')}</span>
        <input name="target" placeholder="example.org" autocomplete="off" autocapitalize="off"
          spellcheck="false" maxlength="2048" required></label>
      <datalist id="device-app-packages">${packages.filter(([, name]) => name !== chromePackage).map(([label, name]) =>
        `<option value="${escape(name)}" label="${escape(label)}"></option>`).join('')}</datalist>
      <label><span class="device-visually-hidden">${copy('addRule')}</span><select name="action">
        <option value="allow">${copy('allow')}</option><option value="temporary">${copy('temporaryAllow')}</option>
        <option value="block">${copy('block')}</option>
      </select></label>
      <button type="submit" class="button primary">${copy('addRule')}</button>
      <label class="device-rule-expiry" data-rule-expiry hidden>${copy('expiry')}
        <input name="expires" type="datetime-local"></label>
    <form class="device-manager-settings" data-device-settings hidden>
      <label class="device-profile-field">${copy('deviceProfile')}<select name="profile">
        <option value="">${copy('unclassified')}</option><option value="mp3">MP3</option><option value="qin">Qin</option>
      </select></label>
      <fieldset>
        <legend>${copy('requestPermissions')}</legend>
        <label class="device-check"><input name="appRequests" type="checkbox"> ${copy('appRequestsEnabled')}</label>
        <label class="device-check"><input name="siteRequests" type="checkbox"> ${copy('siteRequestsEnabled')}</label>
        <p class="device-profile-note" data-mp3-web hidden>${copy('webSectionDisabled')}</p>
      </fieldset>
      <div class="device-settings-footer">
        <button class="button primary" type="submit">${copy('saveDeviceSettings')}</button>
        <p data-device-settings-status role="status" aria-live="polite"></p>
      </div>
    </form>
    <fieldset class="device-section-settings" data-device-sections hidden>
      <legend>${copy('visibleSections')}</legend>
      <label class="device-check"><input type="checkbox" data-web-enabled> ${copy('webSection')}</label>
      <label class="device-check"><input type="checkbox" data-store-enabled> ${copy('storeSection')}</label>
      <p class="device-section-hint">${copy('sectionsHint')}</p>
      <p class="device-section-hint">${copy('sectionsVersion')}</p>
      <p class="device-section-hint" data-sections-profile-hint hidden>${copy('saveProfileFirst')}</p>
      <p data-sections-status role="status" aria-live="polite"></p>
    </fieldset>
    <details class="device-control-section" data-rules-section>
      <summary><span>${copy('rulesSection')}</span><span class="device-section-meta" data-rule-count></span></summary>
      <div class="device-section-content">
        <p class="device-section-hint">${copy('rulesHint')}</p>
        <div data-rule-list></div>
        <details class="device-rule-editor" data-rule-editor>
          <summary>${copy('addRuleSection')}</summary>
          <form data-rule-form class="device-rule-form" hidden>
            <label><span class="device-visually-hidden">${copy('target')}</span><select name="kind">
              <option value="site">${copy('site')}</option><option value="app">${copy('app')}</option>
            </select></label>
            <label><span class="device-visually-hidden">${copy('target')}</span>
              <input name="target" placeholder="example.org" autocomplete="off" autocapitalize="off"
                spellcheck="false" maxlength="2048" required></label>
            <datalist id="device-app-packages">${packages.map(([label, name]) =>
              `<option value="${escape(name)}" label="${escape(label)}"></option>`).join('')}</datalist>
            <label><span class="device-visually-hidden">${copy('addRule')}</span><select name="action">
              <option value="allow">${copy('allow')}</option><option value="temporary">${copy('temporaryAllow')}</option>
              <option value="block">${copy('block')}</option>
            </select></label>
            <button type="submit" class="button primary">${copy('addRule')}</button>
            <label class="device-rule-expiry" data-rule-expiry hidden>${copy('expiry')}
              <input name="expires" type="datetime-local"></label>
          </form>
        </details>
      </div>
    </details>
    <details class="device-control-section" data-client-section>
      <summary><span>${copy('clientSection')}</span>
        <span class="device-section-meta" data-assigned-client>${escape(assignedClient?.name || copy('noClient'))}</span>
      </summary>
      <div class="device-section-content">${clientFormMarkup}</div>
    </details>
    ${peers.length > 1 ? `<details class="device-control-section device-bulk-settings" data-bulk-settings hidden>
      <summary><span>${copy('bulkSection')}</span></summary>
      <div class="device-section-content">
        <p class="device-section-hint">${copy('bulkRequests')}</p>
        <form data-bulk-requests>
          <fieldset class="device-targets"><legend>${copy('selectDevices')}</legend>
            ${peers.map(peer => `<label class="device-check"><input type="checkbox" name="targets"
              value="${escape(peer.id)}"> ${escape(peer.name)}</label>`).join('')}
          </fieldset>
          <label>${copy('appRequestsLabel')}<select name="appRequests">${permissionOptions}</select></label>
          <label>${copy('siteRequestsLabel')}<select name="siteRequests">${permissionOptions}</select></label>
          <button class="button" type="submit">${copy('saveDeviceSettings')}</button>
          <p data-bulk-status role="status" aria-live="polite"></p>
        </form>
      </div>
    </details>` : ''}
  </section>` : clientFormMarkup}`;

  function failure(error) {
    if (['PGRST202', 'PGRST205', '42P01', '42703'].includes(error?.code)) return copy('serviceMissing');
    if (/DEVICE_NOT_AVAILABLE|APP_ACCESS_DENIED|CONFIGURED_DEVICE_REQUIRED/i.test(error?.message || '')) return copy('unavailableDevice');
    if (error?.message === 'INVALID_SITE_WINDOW') return copy('invalidExpiry');
    if (error?.message === 'MANAGED_CHROME_REQUIRED') return copy('chromeUseControl');
    if (error?.message === 'MANAGED_CHROME_UNAVAILABLE') return copy('chromeUnreported');
    if (error?.message === 'DEVICE_RULE_LIMIT') return copy('ruleLimit');
    if (error?.message === 'MP3_WEB_DISABLED') return copy('mp3WebDisabled');
    if (error?.message === 'WEB_SECTION_DISABLED') return copy('webSectionDisabled');
    return copy('retry');
  }

  const clientForm = host.querySelector('[data-client-form]');
  const clientStatus = clientForm.querySelector('[data-client-status]');
  const clientSelect = clientForm.elements.client;
  const saveClient = clientForm.querySelector('button');
  clientForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (saveClient.disabled) return;
    saveClient.disabled = clientSelect.disabled = true;
    clientStatus.textContent = copy('wait');
    try {
      const value = clientSelect.value || null;
      await api.assignDeviceClient(device.id, value);
      device.client_id = value;
      const clientSummary = host.querySelector('[data-assigned-client]');
      if (clientSummary) {
        clientSummary.textContent = eligibleClients.find(client => client.id === value)?.name || copy('noClient');
      }
      options.onAssignment?.(value);
      clientStatus.textContent = copy('savedClient');
    } catch (error) {
      clientStatus.textContent = failure(error);
    } finally {
      saveClient.disabled = clientSelect.disabled = false;
    }
  });

  if (!controlsAvailable) return;
  const rules = host.querySelector('[data-rules]');
  const status = rules.querySelector('[data-policy-status]');
  const syncStatus = rules.querySelector('[data-policy-sync]');
  const policyError = rules.querySelector('[data-policy-error]');
  const chromePanel = rules.querySelector('[data-managed-chrome]');
  const chromeStatus = rules.querySelector('[data-chrome-status]');
  const toggleChrome = rules.querySelector('[data-toggle-chrome]');
  const list = rules.querySelector('[data-rule-list]');
  const form = rules.querySelector('[data-rule-form]');
  const refresh = rules.querySelector('[data-refresh-policy]');
  const settings = rules.querySelector('[data-device-settings]');
  const bulk = rules.querySelector('[data-bulk-settings]');
  const settingsStatus = rules.querySelector('[data-device-settings-status]');
  const siteOption = form.elements.kind.querySelector('[value="site"]');
  const sections = rules.querySelector('[data-device-sections]');
  const sectionWeb = sections.querySelector('[data-web-enabled]');
  const sectionStore = sections.querySelector('[data-store-enabled]');
  const sectionsStatus = sections.querySelector('[data-sections-status]');
  let sectionsAvailable = false;
  let sectionState = { webEnabled: true, appStoreEnabled: true };
  let savedPolicy;
  let savedProfile = '';
  let busy = false;

  function setError(message) {
    policyError.textContent = message;
    policyError.hidden = !message;
  }

  function renderPolicy(policy) {
    savedPolicy = policy;
    const synchronized = Date.parse(policy.last_sync_at);
    let state = 'neverSynced';
    if (policy.apply_failed) state = 'rulesFailed';
    else if (Number(policy.revision) > Number(policy.applied_revision)) state = 'rulesPending';
    else if (Number.isFinite(synchronized)) state = 'rulesApplied';
    status.textContent = copy(state);
    status.dataset.state = state;
    syncStatus.textContent = Number.isFinite(synchronized)
      ? copy('lastSync') + ' ' + new Date(synchronized).toLocaleString(language) : '';
    const supportsSettings = typeof policy.app_requests_enabled === 'boolean';
    settings.hidden = !supportsSettings;
    if (bulk) bulk.hidden = !supportsSettings;
    savedProfile = policy.device_profile || '';
    settings.elements.profile.value = savedProfile;
    settings.elements.appRequests.checked = policy.app_requests_enabled === true;
    settings.elements.siteRequests.checked = policy.site_requests_enabled === true;
    sectionState = deviceSections(policy);
    sectionsAvailable = typeof policy.web_enabled === 'boolean' && typeof policy.app_store_enabled === 'boolean';
    sections.hidden = !sectionsAvailable;
    sectionWeb.checked = sectionState.webEnabled;
    sectionStore.checked = sectionState.appStoreEnabled;
    siteOption.disabled = siteOption.hidden = !sectionState.webEnabled;
    if (siteOption.disabled && form.elements.kind.value === 'site') {
      form.elements.kind.value = 'app';
      form.elements.kind.dispatchEvent(new Event('change'));
    }
    const chrome = managedChromeControl(policy);
    chromePanel.hidden = false;
    chromeStatus.textContent = copy(chrome.status);
    toggleChrome.hidden = chrome.toggle === null;
    toggleChrome.textContent = copy(chrome.toggle ? 'chromeEnable' : 'chromeDisable');
    toggleChrome.onclick = chrome.toggle === null ? null :
      () => runPolicy(() => api.setManagedChrome(device.id, chrome.toggle));

    updateProfileFields();
    const siteRules = new Map(Object.entries(policy.sites || {}));
    const temporary = new Map();
    for (const [target, expiresAt] of Object.entries(policy.temporary_sites || {})) {
      const expiry = Date.parse(expiresAt);
      if (expiry > Date.now()) {
        temporary.set(target, expiry);
        siteRules.set(target, true);
      }
    }
    const entries = Object.entries(policy.apps || {}).filter(([target]) => target !== chromePackage)
      .map(([target, allowed]) => ['app', target, allowed])
      .concat(Array.from(siteRules, ([target, allowed]) => ['site', target, allowed]));
    const entries = Object.entries(policy.apps || {}).map(([target, allowed]) => ['app', target, allowed])
      .concat(Array.from(siteRules, ([target, allowed]) => ['site', target, allowed]))
      .filter(([, , allowed]) => typeof allowed === 'boolean');
    rules.querySelector('[data-rule-count]').textContent = String(entries.length);
    list.replaceChildren();
    if (!entries.length) {
      const paragraph = document.createElement('p');
      paragraph.textContent = copy('noRules');
      list.append(paragraph);
    }
    for (const [kind, target, allowed] of entries) {
      const row = document.createElement('div');
      row.className = 'device-rule';
      const identity = document.createElement('div');
      identity.className = 'device-rule-identity';
      const label = document.createElement('strong');
      const name = packages.find(([, name]) => kind === 'app' && name === target)?.[0];
      label.textContent = name || target;
      const detail = document.createElement('small');
      detail.textContent = name ? target : copy(kind);
      identity.append(label, detail);
      const stateLabel = document.createElement('span');
      stateLabel.className = 'device-rule-state';
      stateLabel.dataset.allowed = String(allowed);
      const expiresAt = kind === 'site' ? temporary.get(target) : null;
      const permanentlyAllowed = kind === 'site' && policy.sites?.[target] === true;
      stateLabel.textContent = expiresAt && !permanentlyAllowed
        ? copy('allowedUntil') + ' ' + new Date(expiresAt).toLocaleString(language)
        : copy(allowed ? 'allowed' : 'blocked');
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'button';
      toggle.textContent = copy(expiresAt ? 'blockPermanently' : allowed ? 'block' : 'allow');
      toggle.setAttribute('aria-label', toggle.textContent + ' ' + label.textContent);
      toggle.onclick = () => runPolicy(() => api.setDeviceRule(device.id, kind, target, !allowed));
      row.append(identity, stateLabel, toggle);
      list.append(row);
    }
    form.hidden = false;
  }

  async function runPolicy(operation) {
    if (busy) return;
    busy = true;
    rules.setAttribute('aria-busy', 'true');
    rules.querySelectorAll('button, input, select').forEach(element => { element.disabled = true; });
    setError('');
    try {
      const policy = await operation();
      if (!policy || !Number.isSafeInteger(Number(policy.revision))) throw new Error('INVALID_POLICY');
      if (host.isConnected) renderPolicy(policy);
      return true;
    } catch (error) {
      if (host.isConnected) setError(failure(error));
    } finally {
      busy = false;
      rules.removeAttribute('aria-busy');
      rules.querySelectorAll('button, input, select').forEach(element => { element.disabled = false; });
      siteOption.disabled = !sectionState.webEnabled;
      updateProfileFields();
      updateExpiryField();
    }
    return false;
  }

  const expiryLabel = form.querySelector('[data-rule-expiry]');
  const expiryInput = form.elements.expires;
  const action = form.elements.action;
  const temporaryOption = action.querySelector('[value="temporary"]');

  function updateExpiryField() {
    const app = form.elements.kind.value === 'app';
    temporaryOption.hidden = temporaryOption.disabled = app;
    if (app && action.value === 'temporary') action.value = 'allow';
    const temporary = action.value === 'temporary';
    expiryLabel.hidden = !temporary;
    expiryInput.required = temporary;
    if (!temporary) expiryInput.value = '';
  }

  function updateProfileFields() {
    const changedProfile = settings.elements.profile.value !== savedProfile;
    const webEnabled = changedProfile ? settings.elements.profile.value !== 'mp3' : sectionState.webEnabled;
    settings.querySelector('[data-mp3-web]').hidden = webEnabled;
    settings.elements.siteRequests.disabled = busy || !webEnabled;
    if (!webEnabled) settings.elements.siteRequests.checked = false;
    sectionWeb.disabled = sectionStore.disabled = busy || changedProfile || !sectionsAvailable;
    sections.querySelector('[data-sections-profile-hint]').hidden = !changedProfile;
  }

  async function saveSections() {
    if (busy || !sectionsAvailable) return;
    const web = sectionWeb.checked, store = sectionStore.checked;
    // Keep the last confirmed state visible until the service returns its policy.
    sectionWeb.checked = sectionState.webEnabled;
    sectionStore.checked = sectionState.appStoreEnabled;
    sectionsStatus.textContent = copy('wait');
    const saved = await runPolicy(() => api.saveDeviceSections(device.id, web, store));
    if (!host.isConnected) return;
    if (!saved && savedPolicy) renderPolicy(savedPolicy);
    sectionsStatus.textContent = saved ? copy('sectionsSaved') : copy('retry');
  }
  sectionWeb.onchange = saveSections;
  sectionStore.onchange = saveSections;

  settings.elements.profile.onchange = () => {
    if (!savedProfile && settings.elements.profile.value) {
      settings.elements.appRequests.checked = settings.elements.siteRequests.checked = false;
    }
    updateProfileFields();
  };
  settings.onsubmit = async event => {
    event.preventDefault();
    const { profile, appRequests, siteRequests } = settings.elements;
    settingsStatus.textContent = '';
    if (await runPolicy(() => api.saveDeviceControls(device.id, profile.value || null,
      appRequests.checked, siteRequests.checked))) settingsStatus.textContent = copy('settingsSaved');
  };
  if (bulk) {
    const bulkForm = bulk.querySelector('form');
    const bulkStatus = bulkForm.querySelector('[data-bulk-status]');
    bulkForm.onsubmit = async event => {
      event.preventDefault();
      const data = new FormData(bulkForm);
      const ids = data.getAll('targets');
      const permission = name => data.get(name) ? data.get(name) === 'on' : null;
      const app = permission('appRequests');
      const site = permission('siteRequests');
      bulkStatus.textContent = '';
      if (!ids.length || (app === null && site === null)) {
        setError(copy('invalidRequestSelection'));
        return;
      }
      if (await runPolicy(async () => {
        await api.saveRequestPermissions(ids, app, site);
        return api.loadDevicePolicy(device.id);
      })) {
        bulkForm.reset();
        bulkStatus.textContent = copy('settingsSaved');
      }
    };
  }

  action.addEventListener('change', updateExpiryField);
  form.elements.kind.addEventListener('change', () => {
    const input = form.elements.target;
    const app = form.elements.kind.value === 'app';
    input.value = '';
    input.placeholder = app ? 'com.example.app' : 'example.org';
    if (app) input.setAttribute('list', 'device-app-packages');
    else input.removeAttribute('list');
    updateExpiryField();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const kind = form.elements.kind.value;
    const target = normalizeRuleTarget(kind, form.elements.target.value);
    if (!target) {
      setError(copy('invalidTarget'));
      return;
    }
    if (kind === 'app' && target === chromePackage) {
      setError(copy('chromeUseControl'));
      return;
    }
    let save;
    if (kind === 'site' && action.value === 'temporary') {
      const expiresAt = normalizeSiteExpiry(expiryInput.value);
      if (!expiresAt) {
        setError(copy('invalidExpiry'));
        return;
      }
      save = () => api.setTemporarySiteRule(device.id, target, expiresAt);
    } else {
      save = () => api.setDeviceRule(device.id, kind, target, action.value === 'allow');
    }
    if (await runPolicy(save)) {
      form.elements.target.value = '';
      expiryInput.value = '';
      rules.querySelector('[data-rule-editor]').open = false;
    }
  });
  refresh.onclick = () => runPolicy(() => api.loadDevicePolicy(device.id));
  status.textContent = copy('wait');
  refresh.click();
}
