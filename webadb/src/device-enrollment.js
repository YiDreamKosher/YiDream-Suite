import { deviceCopy } from './device-control-copy.js';

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

export function enrollmentProgress(status, attempt) {
  if (!attempt) return null;
  if (status.redeemed_activation_id === attempt.id) {
    return Number.isFinite(Date.parse(status.last_sync_at)) ? 'enrollmentSynced' : 'enrollmentRedeemed';
  }
  return status.pending_activation_id === attempt.id ? 'enrollmentWaiting' : 'enrollmentReplaced';
}

export function mountDeviceEnrollment(host, { deviceId, language, api, sendCode }) {
  const copy = key => deviceCopy(language, key);
  let status;
  let attempt;
  let error = '';
  let delivery = '';
  let busy = false;
  let disposed = false;
  let pollTimer;
  let expiryTimer;
  let pollUntil = 0;
  let email = '';
  let phone = '';

  const active = () => !disposed && host.isConnected;
  const find = selector => host.querySelector(selector);

  function scheduleRefresh() {
    clearTimeout(pollTimer);
    if (attempt && Date.now() < pollUntil && active()) pollTimer = setTimeout(() => refresh(false), 2500);
  }

  function errorText(problem) {
    if (problem?.code === 'PGRST202') return copy('serviceMissing');
    if (problem?.message === 'INVALID_CONTACT') return copy('contactInvalid');
    if (problem?.message === 'ACCOUNT_RECOVERY_UNAVAILABLE') return copy('enrollmentRecoveryUnavailable');
    if (/DEVICE_NOT_AVAILABLE|APP_ACCESS_DENIED|CONFIGURED_DEVICE_REQUIRED/.test(problem?.message || '')) {
      return copy('unavailableDevice');
    }
    return copy('retry');
  }

  function retireCode() {
    clearTimeout(expiryTimer);
    if (attempt) attempt.code = null;
    delivery = '';
  }

  async function refresh(manual = true) {
    if (busy || !active()) return;
    busy = true;
    if (manual) {
      error = '';
      render();
    }
    try {
      const result = await api.loadDeviceEnrollment(deviceId);
      if (!active()) return;
      if (result?.device_id !== deviceId || !['unlinked', 'linked', 'suspended'].includes(result.state)) {
        throw new Error('INVALID_ENROLLMENT');
      }
      status = result;
      const state = enrollmentProgress(status, attempt);
      if (state && state !== 'enrollmentWaiting') retireCode();
      if (state === 'enrollmentSynced' || state === 'enrollmentReplaced') pollUntil = 0;
    } catch (problem) {
      if (manual) error = errorText(problem);
    } finally {
      busy = false;
      render();
      scheduleRefresh();
    }
  }

  async function issue() {
    if (busy || !active() || status?.can_issue !== true) return;
    busy = true;
    error = '';
    render();
    try {
      const response = await api.issueDeviceActivation(deviceId, email, phone);
      if (!active()) return;
      const expiresAt = Date.parse(response?.expires_at);
      if (response?.device_id !== deviceId || !uuid.test(response.activation_id || '') ||
          !/^[0-9a-f]{32}$/i.test(response.code || '') || !(expiresAt > Date.now())) {
        throw new Error('INVALID_ENROLLMENT_CODE');
      }
      retireCode();
      email = phone = '';
      attempt = { id: response.activation_id, code: response.code, expiresAt };
      status = { ...status, pending_activation_id: attempt.id };
      pollUntil = Math.min(expiresAt, Date.now() + 90_000);
      expiryTimer = setTimeout(() => {
        if (!active()) return;
        retireCode();
        error = copy('expired');
        render();
        refresh(false);
      }, expiresAt - Date.now());
      if (sendCode) {
        render();
        try {
          if (await sendCode(attempt.code)) delivery = copy('enrollmentUsbDelivered');
        } catch {
          delivery = copy('sendFailed');
        }
      }
    } catch (problem) {
      error = errorText(problem);
    } finally {
      busy = false;
      render();
      scheduleRefresh();
    }
  }

  function render() {
    if (!active()) return;
    const progress = status && enrollmentProgress(status, attempt);
    const linked = status?.state === 'linked';
    const syncTime = linked && Number.isFinite(Date.parse(status.last_sync_at))
      ? new Date(status.last_sync_at).toLocaleString(language) : null;
    const code = attempt?.code;
    const issueForm = status?.can_issue === true && !code
      ? `<form data-enrollment-issue>
        ${status.needs_contact ? `<div class="setup-contact">
          <label>${copy('email')}<input name="email" type="email" autocomplete="off" maxlength="254"
            value="${escape(email)}" required></label>
          <label>${copy('phone')}<input name="phone" type="tel" autocomplete="off" maxlength="24"
            placeholder="+33612345678" value="${escape(phone)}" required></label>
        </div><p class="small">${copy('phoneHelp')}</p>` : ''}
        <button type="submit" class="button primary">${copy(linked ? 'enrollmentReissue' : 'issue')}</button>
      </form>` : '';
    host.innerHTML = `<div class="device-enrollment-heading">
        <h3>${copy('enrollmentTitle')}</h3>
        <button type="button" class="button" data-enrollment-refresh>${copy('refresh')}</button>
      </div>
      ${status ? `<p>${copy(linked ? 'enrollmentLinked' : status.state === 'suspended' ? 'enrollmentSuspended' : 'enrollmentUnlinked')}
        ${syncTime ? `<small>· ${copy('lastSync')} ${escape(syncTime)}</small>` : ''}</p>` : ''}
      <p role="status" ${!progress && !busy ? 'hidden' : ''}>${copy(progress || 'wait')}</p>
      ${delivery ? `<p>${escape(delivery)}</p>` : ''}
      ${code ? `<p>${copy('enrollmentManual')}</p>
        <div class="setup-id"><code dir="ltr">${escape(code)}</code>
          <button type="button" class="button" data-enrollment-copy>${copy('copy')}</button></div>
        <p class="small">${copy('expires')} ${escape(new Date(attempt.expiresAt).toLocaleTimeString(language, {
          hour: '2-digit', minute: '2-digit'
        }))}</p>` : ''}
      ${linked && !status.can_issue ? `<p>${copy('enrollmentRecoveryUnavailable')}</p>` : ''}
      ${error ? `<p class="setup-error" role="alert">${escape(error)}</p>` : ''}${issueForm}`;
    if (busy) host.querySelectorAll('button, input').forEach(element => { element.disabled = true; });
    find('[data-enrollment-refresh]').onclick = () => refresh();
    const form = find('[data-enrollment-issue]');
    if (form) {
      form.oninput = () => {
        email = form.elements.email?.value || '';
        phone = form.elements.phone?.value || '';
      };
      form.onsubmit = event => {
        event.preventDefault();
        form.oninput();
        issue();
      };
    }
    const copyButton = find('[data-enrollment-copy]');
    if (copyButton) copyButton.onclick = async () => {
      if (!attempt?.code || Date.now() >= attempt.expiresAt) return;
      try {
        await navigator.clipboard.writeText(attempt.code);
        if (active()) copyButton.textContent = copy('copied');
      } catch {
        const range = document.createRange();
        range.selectNodeContents(copyButton.previousElementSibling);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    };
  }

  refresh();
  return {
    dispose() {
      disposed = true;
      clearTimeout(pollTimer);
      retireCode();
      host.replaceChildren();
    }
  };
}
