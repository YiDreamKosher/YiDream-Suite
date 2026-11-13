import { deviceCopy } from './device-control-copy.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
const packageName = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const hostname = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

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

export function mountDeviceControls(host, options) {
  const { device, devices = [], clients, language, packages, api } = options;
  const copy = key => deviceCopy(language, key);
  const eligibleClients = clients.filter(client => client.user_id === device.user_id);
  const controlsAvailable = device.platform === 'Android' && device.configuration_status === 'configured';
  const peers = devices.filter(candidate => candidate.platform === 'Android' &&
    candidate.configuration_status === 'configured' && candidate.user_id === device.user_id);
  const permissionOptions = `<option value="">${copy('keepPermission')}</option>
    <option value="on">${copy('enablePermission')}</option><option value="off">${copy('disablePermission')}</option>`;
  host.innerHTML = `<form class="device-client-form" data-client-form>
    <label>${copy('client')}<select name="client">
      <option value="">${copy('noClient')}</option>
      ${eligibleClients.map(client => `<option value="${escape(client.id)}"
        ${client.id === device.client_id ? 'selected' : ''}>${escape(client.name)}</option>`).join('')}
    </select></label>
    <button class="button" type="submit">${copy('saveClient')}</button>
    <p data-client-status role="status"></p>
  </form>
  ${controlsAvailable ? `<section class="device-rules" data-rules>
    <div class="device-rules-heading"><h3>${copy('deviceManager')}</h3>
      <button type="button" class="button" data-refresh-policy>${copy('refresh')}</button></div>
    <p data-policy-status role="status"></p>
    <p data-policy-error role="alert" hidden></p>
    <form class="device-manager-settings" data-device-settings hidden>
      <label>${copy('deviceProfile')}<select name="profile">
        <option value="">${copy('unclassified')}</option><option value="mp3">MP3</option><option value="qin">Qin</option>
      </select></label>
      <fieldset>
        <legend>${copy('requestPermissions')}</legend>
        <label class="device-check"><input name="appRequests" type="checkbox"> ${copy('appRequestsEnabled')}</label>
        <label class="device-check"><input name="siteRequests" type="checkbox"> ${copy('siteRequestsEnabled')}</label>
        <p data-mp3-web hidden>${copy('mp3WebDisabled')}</p>
      </fieldset>
      <button class="button primary" type="submit">${copy('saveDeviceSettings')}</button>
    </form>
    ${peers.length > 1 ? `<details class="device-bulk-settings" data-bulk-settings hidden>
      <summary>${copy('bulkRequests')}</summary>
      <form data-bulk-requests>
        <fieldset class="device-targets"><legend>${copy('selectDevices')}</legend>
          ${peers.map(peer => `<label class="device-check"><input type="checkbox" name="targets"
            value="${escape(peer.id)}"> ${escape(peer.name)}</label>`).join('')}
        </fieldset>
        <label>${copy('appRequestsLabel')}<select name="appRequests">${permissionOptions}</select></label>
        <label>${copy('siteRequestsLabel')}<select name="siteRequests">${permissionOptions}</select></label>
        <button class="button" type="submit">${copy('saveDeviceSettings')}</button>
      </form>
    </details>` : ''}
    <p data-device-settings-status role="status"></p>
    <h4>${copy('rules')}</h4>
    <p>${copy('rulesHint')}</p>
    <div data-rule-list></div>
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
  </section>` : ''}`;

  function failure(error) {
    if (['PGRST202', 'PGRST205', '42P01', '42703'].includes(error?.code)) return copy('serviceMissing');
    if (/DEVICE_NOT_AVAILABLE|APP_ACCESS_DENIED|CONFIGURED_DEVICE_REQUIRED/i.test(error?.message || '')) return copy('unavailableDevice');
    if (error?.message === 'INVALID_SITE_WINDOW') return copy('invalidExpiry');
    if (error?.message === 'MP3_WEB_DISABLED') return copy('mp3WebDisabled');
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
  const policyError = rules.querySelector('[data-policy-error]');
  const list = rules.querySelector('[data-rule-list]');
  const form = rules.querySelector('[data-rule-form]');
  const refresh = rules.querySelector('[data-refresh-policy]');
  const settings = rules.querySelector('[data-device-settings]');
  const bulk = rules.querySelector('[data-bulk-settings]');
  const settingsStatus = rules.querySelector('[data-device-settings-status]');
  const siteOption = form.elements.kind.querySelector('[value="site"]');
  let savedProfile = '';
  let busy = false;

  function setError(message) {
    policyError.textContent = message;
    policyError.hidden = !message;
  }

  function renderPolicy(policy) {
    const synchronized = Date.parse(policy.last_sync_at);
    let state = 'neverSynced';
    if (policy.apply_failed) state = 'rulesFailed';
    else if (Number(policy.revision) > Number(policy.applied_revision)) state = 'rulesPending';
    else if (Number.isFinite(synchronized)) state = 'rulesApplied';
    status.textContent = copy(state);
    if (Number.isFinite(synchronized)) {
      status.textContent += ' · ' + copy('lastSync') + ' ' + new Date(synchronized).toLocaleString(language);
    }
    const supportsSettings = typeof policy.app_requests_enabled === 'boolean';
    settings.hidden = !supportsSettings;
    if (bulk) bulk.hidden = !supportsSettings;
    savedProfile = policy.device_profile || '';
    settings.elements.profile.value = savedProfile;
    settings.elements.appRequests.checked = policy.app_requests_enabled === true;
    settings.elements.siteRequests.checked = policy.site_requests_enabled === true;
    siteOption.disabled = siteOption.hidden = savedProfile === 'mp3';
    if (siteOption.disabled && form.elements.kind.value === 'site') {
      form.elements.kind.value = 'app';
      form.elements.kind.dispatchEvent(new Event('change'));
    }
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
    const entries = Object.entries(policy.apps || {}).map(([target, allowed]) => ['app', target, allowed])
      .concat(Array.from(siteRules, ([target, allowed]) => ['site', target, allowed]));
    list.replaceChildren();
    if (!entries.length) {
      const paragraph = document.createElement('p');
      paragraph.textContent = copy('noRules');
      list.append(paragraph);
    }
    for (const [kind, target, allowed] of entries) {
      if (typeof allowed !== 'boolean') continue;
      const row = document.createElement('div');
      row.className = 'device-rule';
      const label = document.createElement('span');
      label.textContent = packages.find(([, name]) => kind === 'app' && name === target)?.[0] || target;
      label.title = target;
      const stateLabel = document.createElement('span');
      stateLabel.className = 'device-rule-state';
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
      row.append(label, stateLabel, toggle);
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
    const mp3 = settings.elements.profile.value === 'mp3';
    settings.querySelector('[data-mp3-web]').hidden = !mp3;
    settings.elements.siteRequests.disabled = busy || mp3;
    if (mp3) settings.elements.siteRequests.checked = false;
  }

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
    bulkForm.onsubmit = async event => {
      event.preventDefault();
      const data = new FormData(bulkForm);
      const ids = data.getAll('targets');
      const permission = name => data.get(name) ? data.get(name) === 'on' : null;
      const app = permission('appRequests');
      const site = permission('siteRequests');
      settingsStatus.textContent = '';
      if (!ids.length || (app === null && site === null)) {
        setError(copy('invalidRequestSelection'));
        return;
      }
      if (await runPolicy(async () => {
        await api.saveRequestPermissions(ids, app, site);
        return api.loadDevicePolicy(device.id);
      })) {
        bulkForm.reset();
        bulk.open = false;
        settingsStatus.textContent = copy('settingsSaved');
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
    }
  });
  refresh.onclick = () => runPolicy(() => api.loadDevicePolicy(device.id));
  status.textContent = copy('wait');
  refresh.click();
}
