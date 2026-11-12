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
}

export function mountDeviceControls(host, options) {
  const { device, clients, language, packages, api } = options;
  const copy = key => deviceCopy(language, key);
  const eligibleClients = clients.filter(client => client.user_id === device.user_id);
  const controlsAvailable = device.platform === 'Android' && device.configuration_status === 'configured';
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
    <div class="device-rules-heading"><h3>${copy('rules')}</h3>
      <button type="button" class="button" data-refresh-policy>${copy('refresh')}</button></div>
    <p>${copy('rulesHint')}</p>
    <p data-policy-status role="status"></p>
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
    </form>
  </section>` : ''}`;

  function failure(error) {
    if (['PGRST202', 'PGRST205', '42P01', '42703'].includes(error?.code)) return copy('serviceMissing');
    if (/DEVICE_NOT_AVAILABLE|APP_ACCESS_DENIED|CONFIGURED_DEVICE_REQUIRED/i.test(error?.message || '')) return copy('unavailableDevice');
    if (error?.message === 'INVALID_SITE_WINDOW') return copy('invalidExpiry');
    if (error?.message === 'MANAGED_CHROME_REQUIRED') return copy('chromeUseControl');
    if (error?.message === 'MANAGED_CHROME_UNAVAILABLE') return copy('chromeUnreported');
    if (error?.message === 'DEVICE_RULE_LIMIT') return copy('ruleLimit');
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
  const chromePanel = rules.querySelector('[data-managed-chrome]');
  const chromeStatus = rules.querySelector('[data-chrome-status]');
  const toggleChrome = rules.querySelector('[data-toggle-chrome]');
  const list = rules.querySelector('[data-rule-list]');
  const form = rules.querySelector('[data-rule-form]');
  const refresh = rules.querySelector('[data-refresh-policy]');
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
    const chrome = managedChromeControl(policy);
    chromePanel.hidden = false;
    chromeStatus.textContent = copy(chrome.status);
    toggleChrome.hidden = chrome.toggle === null;
    toggleChrome.textContent = copy(chrome.toggle ? 'chromeEnable' : 'chromeDisable');
    toggleChrome.onclick = chrome.toggle === null ? null :
      () => runPolicy(() => api.setManagedChrome(device.id, chrome.toggle));

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
    }
  });
  refresh.onclick = () => runPolicy(() => api.loadDevicePolicy(device.id));
  status.textContent = copy('wait');
  refresh.click();
}
