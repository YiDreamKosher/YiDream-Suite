import { YiDreamAdb } from './adb.js';
import { fetchCurrentApk } from './current-apk.js';
import { phoneProfileConfiguration } from './android-setup.js';
import { ANDROID_PROFILES, PROFILE_VERSION_CODE, isProfileProtected, profileApps } from './android-profiles.js';
import { prepareProfiledUsbPhone } from './usb-profile-policy.js';
import { deviceCopy } from './device-control-copy.js';
import { mountDeviceEnrollment } from './device-enrollment.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

const deviceId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function mountUsbEnrollment(host, usb, options) {
  const { language, targetDevice, owner, api, translateError, openRecord } = options;
  const copy = key => deviceCopy(language, key);
  const state = {
    step: usb.info ? 1 : 0,
    busy: false,
    preparedSerial: null,
    registration: null,
    phone: null,
    profile: '',
    installed: null,
    excludedApps: new Set(),
    extra: '',
    error: '',
    progress: ''
  };
  let disposed = false;
  let enrollmentHost;
  let enrollment;

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

  function errorMessage(error) {
    if (error?.code === 'PGRST202') return copy('serviceMissing');
    if (error?.message === 'CONFIGURATION_NOT_CONFIRMED') return copy('configUnconfirmed');
    if (error?.message === 'DEVICE_OWNER_NOT_CONFIRMED') return copy('ownerUnconfirmed');
    if (error?.message === 'INVALID_CONTACT') return copy('contactInvalid');
    const profileErrors = {
      PROFILE_REQUIRED: 'chooseProfile',
      PROFILE_UPDATE_REQUIRED: 'profileUpdateRequired',
      PROFILE_INVALID_PACKAGE: 'profileInvalidPackage',
      PROFILE_PLAY_APP_NOT_INSTALLED: 'profilePlayAppNotInstalled',
      PROFILE_STORE_BLOCKED: 'profileStoreBlocked',
      PROFILE_PROTECTED_PACKAGE: 'profileProtectedPackage',
      PROFILE_PACKAGE_LIMIT: 'profilePackageLimit',
      USB_PROFILE_APP_DENIED: 'profileAppDenied',
      USB_PROFILE_INVALID_PACKAGES: 'profileInvalidPackage',
      USB_PROFILE_INVALID_TYPE: 'chooseProfile',
      USB_PROFILE_APP_PROTECTED: 'profileProtectedPackage',
      USB_REGISTRATION_REQUIRED: 'unavailableDevice',
      DEVICE_RULE_LIMIT: 'profilePackageLimit'
    };
    if (Object.hasOwn(profileErrors, error?.message)) return copy(profileErrors[error.message]);
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
      if (error?.message === 'USB_PROFILE_APP_DENIED') {
        state.preparedSerial = null;
        state.step = 1;
      }
    } finally {
      state.busy = false;
      state.progress = '';
      render();
    }
  }

  async function readInstalledPackages() {
    const serial = usb.info?.serial;
    if (!serial) return;
    state.installed = null;
    progress(copy('readingApps'));
    try {
      const installed = await usb.listInstalledPackages(serial);
      checkPhone(serial);
      state.installed = installed;
    } catch {
      checkPhone(serial);
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
    }
    state.phone = { ...usb.info };
    state.step = state.registration ? 2 : 1;
    if (!state.registration) await readInstalledPackages();
  }

  async function prepare() {
    const phone = usb.info && { ...usb.info };
    if (!phone?.serial) throw new Error('NOT_CONNECTED');
    if (!Object.hasOwn(ANDROID_PROFILES, state.profile)) throw new Error('PROFILE_REQUIRED');
    if (await api.verifyUsbTarget(phone, targetDevice?.id || null) !== true) {
      throw new Error(copy(targetDevice ? 'wrongPhone' : 'unavailableDevice'));
    }
    checkPhone(phone.serial);
    const material = await api.getAndroidUnlockMaterial();
    checkPhone(phone.serial);
    const selected = profileApps(state.profile).filter(app => !state.excludedApps.has(app.packageName))
      .flatMap(app => app.packageNames);
    const config = phoneProfileConfiguration(state.profile, state.installed, state.extra, material,
      crypto.randomUUID(), selected);
    const release = await fetchCurrentApk(fetch, crypto, PROFILE_VERSION_CODE);
    checkPhone(phone.serial);
    const record = await prepareProfiledUsbPhone(usb, release, config, api, targetDevice?.id || null,
      phase => progress(copy(phase === 'install' ? 'install' : phase === 'owner' ? 'manage' : phase === 'apply' ? 'applying' : 'register')),
      () => checkPhone(phone.serial));
    checkPhone(phone.serial);
    state.phone = phone;
    state.preparedSerial = phone.serial;
    state.registration = record;
    state.step = 2;
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

  function preparationOptions() {
    const profiles = Object.entries(ANDROID_PROFILES).map(([key, label]) => (
      `<label class="setup-profile-choice">
        <input type="radio" name="androidProfile" value="${key}" ${state.profile === key ? 'checked' : ''}>
        <span><b>${label}</b><small>${copy(key === 'mp3' ? 'mp3Profile' : 'qinProfile')}</small></span>
      </label>`
    )).join('');
    return `<fieldset class="setup-profiles">
      <legend>${copy('deviceProfile')}</legend>
      <div class="setup-profile-choices">${profiles}</div>
    </fieldset>${state.profile ? profileDetails() : ''}`;
  }

  function profileDetails() {
    const apps = profileApps(state.profile);
    const rows = apps.map(({ name, packageName, packageNames, builtIn }) => {
      let status = 'onPhone';
      if (!state.installed) status = 'notVerifiedOnPhone';
      else if (!packageNames.some(name => state.installed.has(name))) status = 'allowedIfInstalled';
      const present = packageNames.filter(name => state.installed?.has(name));
      return `<li><label class="setup-profile-app-choice">
        <input type="checkbox" data-profile-app="${packageName}" ${state.excludedApps.has(packageName) ? '' : 'checked'}>
        <span><b>${builtIn ? copy(name) : name}</b><small>${copy(status)}</small>
          <code dir="ltr">${(present.length ? present : [packageName]).join(', ')}</code>
        </span></label></li>`;
    }).join('');
    const defaults = new Set(apps.flatMap(app => app.packageNames));
    const suggestions = [...(state.installed || [])]
      .filter(packageName => !defaults.has(packageName) && !isProfileProtected(packageName))
      .sort().map(packageName => `<option value="${escape(packageName)}"></option>`).join('');
    const selectedCount = apps.filter(app => !state.excludedApps.has(app.packageName)).length;
    return `<details class="setup-help setup-profile-apps">
      <summary data-profile-selection-summary>${copy('profileCustomize')} · ${selectedCount}/${apps.length}</summary>
      <ul>${rows}</ul>
      <p>${copy('profileInstallHint')}</p>
    </details>
    <details class="setup-help" ${state.extra ? 'open' : ''}>
      <summary>${copy('profileExtras')}</summary>
      <label for="setupExtra">${copy('extraApps')}</label>
      <input id="setupExtra" data-setup-extra list="setupInstalledApps" value="${escape(state.extra)}"
        placeholder="com.example.app" dir="ltr" autocapitalize="off" autocomplete="off" spellcheck="false"
        maxlength="25700" aria-describedby="setupExtraHint">
      <datalist id="setupInstalledApps">${suggestions}</datalist>
      <p id="setupExtraHint">${copy(state.installed ? 'profileExtrasHint' : 'profileInventoryUnavailable')}</p>
    </details>`;
  }

  function registrationPanel() {
    const { device_id, configuration_status } = state.registration;
    const ready = configuration_status === 'configured';
    return `<div class="setup-registration">
      <b>${copy('deviceId')}</b>
      <div class="setup-id"><code dir="ltr">${escape(device_id)}</code>
        <button type="button" class="ghost" data-copy-id>${copy('copy')}</button></div>
      ${ready ? '<div data-setup-enrollment></div>' : `<p>${copy(owner ? 'approvalHint' : 'awaiting')}</p>
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
    const knownId = state.registration?.device_id || targetDevice?.id;
    const steps = ['connect', 'prepare', 'activate'];
    const phone = usb.info || state.phone;
    const phoneName = [phone?.manufacturer, phone?.model].filter(Boolean).join(' ') || 'Android';
    const connected = Boolean(usb.info);
    const phoneInfo = phone ? `<div class="setup-phone">
      <div><b>${escape(phoneName)}</b><small>Android ${escape(phone.android)}</small></div>
      ${connected ? '<span class="setup-connected">USB</span>' : ''}
    </div>` : '';
    const connectBody = `<p>${copy('connectHint')}</p><details class="setup-help">
      <summary>${copy('help')}</summary><p>${copy('usbHelp')}</p></details>
      <button type="button" class="primary" data-connect>${copy('connectPhone')}</button>`;
    const prepareBody = `<p>${copy('prepareHint')}</p>
      ${preparationOptions()}
      <button type="button" class="primary" data-prepare ${state.profile ? '' : 'disabled'}>${copy('preparePhone')}</button>`;
    host.classList.add('android-guided');
    host.innerHTML = `<div class="setup-heading"><h2>${copy('setup')}</h2></div>
      <ol class="setup-progress" aria-label="${copy('setup')}">
        ${steps.map((key, index) => `<li ${index === step ? 'aria-current="step"' : ''}
          class="${index < step ? 'complete' : ''}"><span aria-hidden="true">${index + 1}</span>
          <b>${copy(key)}</b></li>`).join('')}
      </ol>
      <section class="setup-card" aria-busy="${busy}">
        ${targetDevice ? `<p class="setup-record-name">${copy('chooseDevice')} · <b>${escape(targetDevice.name)}</b></p>` : ''}
        ${step < 2 && deviceId.test(knownId || '') ? `<b>${copy('deviceId')}</b>
          <div class="setup-id"><code dir="ltr">${escape(knownId)}</code>
            <button type="button" class="ghost" data-copy-id>${copy('copy')}</button></div>
          ${targetDevice?.configuration_status === 'configured'
            ? `<button type="button" class="ghost" data-open-record>${copy('enrollmentWithoutUsb')}</button>` : ''}` : ''}
        ${phoneInfo}
        ${step === 0 ? connectBody : step === 1 ? prepareBody : registrationPanel()}
        <p class="setup-error" role="alert" ${state.error ? '' : 'hidden'}>${escape(state.error)}</p>
        <p class="setup-status" data-setup-status role="status">${busy ? escape(state.progress || copy('wait')) : ''}</p>
        ${connected ? `<div class="setup-record-actions">
          <button type="button" class="ghost" data-disconnect>${copy('disconnect')}</button></div>` : ''}
      </section>`;
    if (busy) host.querySelectorAll('button, input, select').forEach(control => { control.disabled = true; });
    find('[data-connect]')?.addEventListener('click', () => run(connect));
    find('[data-prepare]')?.addEventListener('click', () => run(prepare));
    find('[data-approval]')?.addEventListener('click', () => run(owner ? approve : checkApproval));
    find('[data-disconnect]')?.addEventListener('click', () => run(async () => {
      await usb.disconnect();
      disconnected();
    }));
    find('[data-open-record]')?.addEventListener('click', () => run(() => openRecord(knownId)));
    find('[data-copy-id]')?.addEventListener('click', event => copyText(knownId, event.currentTarget));
    host.querySelectorAll('[name="androidProfile"]').forEach(input => {
      input.addEventListener('change', () => {
        if (!Object.hasOwn(ANDROID_PROFILES, input.value)) return;
        state.profile = input.value;
        state.excludedApps.clear();
        state.error = '';
        render();
        find(`[name="androidProfile"][value="${state.profile}"]`)?.focus();
      });
    });
    host.querySelectorAll('[data-profile-app]').forEach(input => {
      input.addEventListener('change', () => {
        if (input.checked) state.excludedApps.delete(input.dataset.profileApp);
        else state.excludedApps.add(input.dataset.profileApp);
        const apps = profileApps(state.profile);
        const selectedCount = apps.filter(app => !state.excludedApps.has(app.packageName)).length;
        find('[data-profile-selection-summary]').textContent = `${copy('profileCustomize')} · ${selectedCount}/${apps.length}`;
      });
    });
    find('[data-setup-extra]')?.addEventListener('input', event => { state.extra = event.currentTarget.value; });
    const enrollmentSlot = find('[data-setup-enrollment]');
    if (enrollmentSlot) {
      if (enrollmentHost) {
        enrollmentSlot.replaceWith(enrollmentHost);
      } else {
        enrollmentHost = enrollmentSlot;
        enrollmentHost.className = 'device-enrollment';
        enrollment = mountDeviceEnrollment(enrollmentHost, {
          deviceId: state.registration.device_id, language, api,
          async sendCode(code) {
            if (usb.info?.serial !== state.preparedSerial) return false;
            checkPhone(state.preparedSerial);
            await usb.sendActivationCode(code, state.preparedSerial);
            return true;
          }
        });
      }
    }
  }

  function disconnected() {
    if (state.registration) {
      render();
      return;
    }
    state.step = state.preparedSerial ? 1 : 0;
    if (!state.preparedSerial) {
      state.profile = '';
      state.installed = null;
      state.excludedApps.clear();
      state.extra = '';
    }
    render();
  }

  render();
  if (usb.info) void run(readInstalledPackages);
  return {
    disconnected,
    dispose() {
      disposed = true;
      enrollment?.dispose();
    }
  };
}
