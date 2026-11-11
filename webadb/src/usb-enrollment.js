import { YiDreamAdb, parseExtraPackages } from './adb.js';
import { fetchCurrentApk } from './current-apk.js';
import { preparePhone, phoneConfiguration } from './android-setup.js';
import { deviceCopy } from './device-control-copy.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

const deviceId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function mountUsbEnrollment(host, usb, options) {
  const { language, groups, targetDevice, owner, api, translateError, openRecord } = options;
  const copy = key => deviceCopy(language, key);
  const state = {
    step: usb.info ? 1 : 0,
    busy: false,
    preparedSerial: null,
    registration: null,
    phone: null,
    activation: null,
    sent: false,
    enabled: new Set(groups.map(group => group.key)),
    extra: '',
    email: '',
    phoneNumber: '',
    error: '',
    progress: ''
  };
  let disposed = false;
  let expiryTimer;

  const active = () => !disposed && host.isConnected;
  const find = selector => host.querySelector(selector);

  function checkPhone(serial) {
    if (!active() || usb.info?.serial !== serial) throw new Error('NOT_CONNECTED');
  }

  function progress(message) {
    state.progress = message;
    const status = find('[data-setup-status]');
    if (status) status.textContent = message;
  }

  function clearCode() {
    clearTimeout(expiryTimer);
    state.activation = null;
    state.sent = false;
  }

  function errorMessage(error) {
    if (error?.code === 'PGRST202') return copy('serviceMissing');
    if (error?.message === 'ACTIVATION_USB_FAILED') return copy('sendFailed');
    if (error?.message === 'CONFIGURATION_NOT_CONFIRMED') return copy('configUnconfirmed');
    if (error?.message === 'DEVICE_OWNER_NOT_CONFIRMED') return copy('ownerUnconfirmed');
    if (error?.message === 'INVALID_CONTACT') return copy('contactInvalid');
    if (/DEVICE_NOT_AVAILABLE|APP_ACCESS_DENIED/i.test(error?.message || '')) return copy('unavailableDevice');
    if (error?.message === 'USB_DEVICE_MISMATCH') return copy('wrongPhone');
    return translateError(error) || copy('retry');
  }

  async function run(action) {
    if (state.busy || !active()) return;
    state.busy = true;
    state.error = '';
    render();
    try {
      await action();
    } catch (error) {
      state.error = errorMessage(error);
    } finally {
      state.busy = false;
      state.progress = '';
      render();
    }
  }

  async function connect() {
    if (!YiDreamAdb.supported) throw new Error('UNSUPPORTED');
    await usb.connect();
    if (!active()) return;
    if (state.registration && state.preparedSerial !== usb.info.serial) {
      await usb.disconnect();
      throw new Error(copy('wrongPhone'));
    }
    if (state.preparedSerial !== usb.info.serial) {
      state.preparedSerial = null;
      state.registration = null;
      clearCode();
    }
    state.phone = { ...usb.info };
    state.step = state.registration ? 2 : 1;
  }

  async function saveRecord() {
    checkPhone(state.preparedSerial);
    progress(copy('register'));
    const record = await api.registerUsbDevice(state.phone, targetDevice?.id || null);
    if (!deviceId.test(record?.device_id || '')) throw new Error(copy('retry'));
    if (!active()) return;
    state.registration = record;
    state.step = 2;
  }

  async function prepare() {
    const phone = usb.info && { ...usb.info };
    if (!phone?.serial) throw new Error('NOT_CONNECTED');
    const packages = groups.filter(group => state.enabled.has(group.key)).flatMap(group => group.packages);
    const extra = parseExtraPackages(state.extra);
    if (extra.invalid.length) throw new Error(copy('invalidTarget'));
    if (await api.verifyUsbTarget(phone, targetDevice?.id || null) !== true) {
      throw new Error(copy(targetDevice ? 'wrongPhone' : 'unavailableDevice'));
    }
    checkPhone(phone.serial);
    const material = await api.getAndroidUnlockMaterial();
    checkPhone(phone.serial);
    const config = phoneConfiguration(packages, state.extra, material);
    const release = await fetchCurrentApk();
    checkPhone(phone.serial);
    await preparePhone(usb, release, phase => progress(copy(phase === 'install' ? 'install' : 'manage')));
    checkPhone(phone.serial);
    progress(copy('applying'));
    await usb.applyConfig(config);
    checkPhone(phone.serial);
    await usb.confirmConfiguration(phone.serial);
    checkPhone(phone.serial);
    state.phone = phone;
    state.preparedSerial = phone.serial;
    await saveRecord();
  }

  async function approve() {
    if (!owner || !state.registration) return;
    await api.setDeviceConfigured(state.registration.device_id, true);
    await checkApproval();
  }

  async function checkApproval() {
    const record = await api.deviceRegistration(state.registration.device_id);
    if (active()) state.registration = record;
  }

  async function send() {
    if (!state.activation || Date.now() >= state.activation.expiresAt) {
      clearCode();
      throw new Error(copy('expired'));
    }
    checkPhone(state.preparedSerial);
    await usb.sendActivationCode(state.activation.code, state.preparedSerial);
    if (active()) state.sent = true;
  }

  async function issue() {
    if (!/^\+[1-9][0-9]{7,14}$/.test(state.phoneNumber.trim().replace(/[\s().-]/g, ''))) {
      throw new Error('INVALID_CONTACT');
    }
    clearCode();
    const response = await api.issueAppActivation(
      state.registration.device_id, state.email, state.phoneNumber
    );
    if (!active()) return;
    const expiresAt = Date.parse(response?.expires_at);
    if (!/^[0-9a-f]{32}$/i.test(response?.code || '') || !(expiresAt > Date.now())) {
      throw new Error(copy('retry'));
    }
    state.activation = { code: response.code, expiresAt };
    expiryTimer = setTimeout(() => {
      clearCode();
      state.error = copy('expired');
      render();
    }, Math.min(900_000, expiresAt - Date.now()));
    if (usb.info?.serial === state.preparedSerial) await send();
  }

  function preparationOptions() {
    return `<details class="setup-help" ${state.enabled.size < groups.length || state.extra ? 'open' : ''}>
      <summary>${copy('options')}</summary>
      <div class="setup-categories">
        ${groups.map(({ key }) => `<label><input type="checkbox" data-setup-category="${key}"
          ${state.enabled.has(key) ? 'checked' : ''}> ${copy(key)}</label>`).join('')}
      </div>
      <label for="setupExtra">${copy('extraApps')}</label>
      <input id="setupExtra" data-setup-extra value="${escape(state.extra)}" placeholder="com.example.app"
        autocapitalize="off" autocomplete="off" spellcheck="false">
    </details>`;
  }

  function activationForm() {
    const activation = state.activation;
    if (activation) {
      const manual = `<details class="setup-help" ${state.sent ? '' : 'open'}>
        <summary>${copy('manual')}</summary>
        <div class="setup-id"><code dir="ltr">${escape(activation.code)}</code>
          <button type="button" class="ghost" data-copy-code>${copy('copy')}</button></div>
        <p>${copy('expires')} ${escape(new Date(activation.expiresAt).toLocaleTimeString(language, {
          hour: '2-digit', minute: '2-digit'
        }))}</p></details>`;
      const sendButton = !state.sent && usb.info?.serial === state.preparedSerial
        ? `<button type="button" class="primary" data-send-code>${copy('send')}</button>` : '';
      return `${state.sent ? `<p class="notice" role="status">${copy('sent')}</p>` : ''}${manual}${sendButton}`;
    }
    return `<form data-activation-form>
      <p>${copy('activationHint')}</p>
      <div class="setup-contact">
        <label>${copy('email')}<input name="email" type="email" autocomplete="off" maxlength="254"
          value="${escape(state.email)}" required></label>
        <label>${copy('phone')}<input name="phone" type="tel" autocomplete="off" maxlength="24"
          value="${escape(state.phoneNumber)}" placeholder="+33612345678" required></label>
      </div>
      <p class="small">${copy('phoneHelp')}</p>
      <button type="submit" class="primary">${copy('issue')}</button>
    </form>`;
  }

  function registrationPanel() {
    const { device_id, configuration_status } = state.registration;
    const ready = configuration_status === 'configured';
    return `<div class="setup-registration">
      <b>${copy('deviceId')}</b>
      <div class="setup-id"><code dir="ltr">${escape(device_id)}</code>
        <button type="button" class="ghost" data-copy-id>${copy('copy')}</button></div>
      ${ready ? activationForm() : `<p>${copy(owner ? 'approvalHint' : 'awaiting')}</p>
        <button type="button" class="primary" data-approval>${copy(owner ? 'approval' : 'checkApproval')}</button>`}
      <div class="setup-record-actions">
        <button type="button" class="ghost" data-open-record>${copy('details')}</button>
        ${!usb.info ? `<button type="button" class="ghost" data-connect>${copy('connectPhone')}</button>` : ''}
      </div>
    </div>`;
  }

  async function copyText(value, button) {
    try {
      await navigator.clipboard.writeText(value);
      if (active()) button.textContent = copy('copied');
    } catch {
      const range = document.createRange();
      range.selectNodeContents(button.previousElementSibling);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  function render() {
    if (!active()) return;
    const { step, busy } = state;
    const steps = ['connect', 'prepare', 'activate'];
    const phone = usb.info || state.phone;
    const phoneName = [phone?.manufacturer, phone?.model].filter(Boolean).join(' ') || 'Android';
    const connected = Boolean(usb.info);
    const recordRetry = Boolean(state.preparedSerial && !state.registration);
    const phoneInfo = phone ? `<div class="setup-phone">
      <div><b>${escape(phoneName)}</b><small>Android ${escape(phone.android)}</small></div>
      ${connected ? '<span class="setup-connected">USB</span>' : ''}
    </div>` : '';
    const connectBody = `<p>${copy('connectHint')}</p><details class="setup-help">
      <summary>${copy('help')}</summary><p>${copy('usbHelp')}</p></details>
      <button type="button" class="primary" data-connect>${copy('connectPhone')}</button>`;
    const prepareBody = `<p>${copy(recordRetry ? 'registeredPending' : 'prepareHint')}</p>
      ${recordRetry ? '' : preparationOptions()}
      <button type="button" class="primary" data-prepare>${copy(recordRetry ? 'registerAgain' : 'preparePhone')}</button>`;
    host.classList.add('android-guided');
    host.innerHTML = `<div class="setup-heading"><h2>${copy('setup')}</h2></div>
      <ol class="setup-progress" aria-label="${copy('setup')}">
        ${steps.map((key, index) => `<li ${index === step ? 'aria-current="step"' : ''}
          class="${index < step ? 'complete' : ''}"><span aria-hidden="true">${index + 1}</span>
          <b>${copy(key)}</b></li>`).join('')}
      </ol>
      <section class="setup-card" aria-busy="${busy}">
        ${targetDevice ? `<p class="setup-record-name">${copy('chooseDevice')} · <b>${escape(targetDevice.name)}</b></p>` : ''}
        ${phoneInfo}
        ${step === 0 ? connectBody : step === 1 ? prepareBody : registrationPanel()}
        <p class="setup-error" role="alert" ${state.error ? '' : 'hidden'}>${escape(state.error)}</p>
        <p class="setup-status" data-setup-status role="status">${busy ? escape(state.progress || copy('wait')) : ''}</p>
        ${connected ? `<div class="setup-record-actions">
          <button type="button" class="ghost" data-disconnect>${copy('disconnect')}</button></div>` : ''}
      </section>`;
    if (busy) host.querySelectorAll('button, input').forEach(control => { control.disabled = true; });
    find('[data-connect]')?.addEventListener('click', () => run(connect));
    find('[data-prepare]')?.addEventListener('click', () => run(recordRetry ? saveRecord : prepare));
    find('[data-approval]')?.addEventListener('click', () => run(owner ? approve : checkApproval));
    find('[data-send-code]')?.addEventListener('click', () => run(send));
    find('[data-disconnect]')?.addEventListener('click', () => run(async () => {
      await usb.disconnect();
      disconnected();
    }));
    find('[data-open-record]')?.addEventListener('click', () => run(() => openRecord(state.registration.device_id)));
    find('[data-copy-id]')?.addEventListener('click', event => copyText(state.registration.device_id, event.currentTarget));
    find('[data-copy-code]')?.addEventListener('click', event => {
      if (state.activation && state.activation.expiresAt > Date.now()) copyText(state.activation.code, event.currentTarget);
    });
    host.querySelectorAll('[data-setup-category]').forEach(input => {
      input.addEventListener('change', () => {
        if (input.checked) state.enabled.add(input.dataset.setupCategory);
        else state.enabled.delete(input.dataset.setupCategory);
      });
    });
    find('[data-setup-extra]')?.addEventListener('input', event => { state.extra = event.currentTarget.value; });
    const form = find('[data-activation-form]');
    if (form) form.addEventListener('submit', event => {
      event.preventDefault();
      state.email = form.elements.email.value;
      state.phoneNumber = form.elements.phone.value;
      run(issue);
    });
  }

  function disconnected() {
    if (state.registration) {
      render();
      return;
    }
    state.step = 0;
    render();
  }

  render();
  return {
    disconnected,
    dispose() {
      disposed = true;
      clearCode();
      state.email = '';
      state.phoneNumber = '';
    }
  };
}
