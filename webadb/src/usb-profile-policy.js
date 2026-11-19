import { ANDROID_PROFILES, profileManagedPackages } from './android-profiles.js';
import { preparePhone } from './android-setup.js';

const deviceId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** Registration and policy preparation never approve a device or activate an account. */
export async function registerPreparedUsbPhone(api, phone, targetDevice, configuration, ensureCurrent = () => {}) {
  if (!Object.hasOwn(ANDROID_PROFILES, configuration?.app_profile) || !Array.isArray(configuration.allowed_packages)) {
    throw new Error('PROFILE_REQUIRED');
  }
  ensureCurrent();
  const record = await api.registerUsbDevice(phone, targetDevice);
  ensureCurrent();
  if (!deviceId.test(record?.device_id || '') || (targetDevice && record.device_id !== targetDevice)) {
    throw new Error('USB_DEVICE_MISMATCH');
  }
  await api.saveUsbAppProfile(record.device_id, configuration.app_profile, configuration.allowed_packages,
    profileManagedPackages(configuration.app_profile, configuration.allowed_packages));
  ensureCurrent();
  return record;
}


/** A fresh server denial must stop preparation before any physical app-policy mutation. */
export async function prepareProfiledUsbPhone(client, release, configuration, api, targetDevice,
    report = () => {}, ensureCurrent = () => {}) {
  const serial = client.info?.serial;
  if (!serial) throw new Error('NOT_CONNECTED');
  const connected = () => {
    ensureCurrent();
    if (client.info?.serial !== serial) throw new Error('NOT_CONNECTED');
  };
  report('register');
  const record = await registerPreparedUsbPhone(api, { ...client.info }, targetDevice, configuration, connected);
  connected();
  await preparePhone(client, release, report);
  connected();
  report('apply');
  await client.applyConfig(configuration);
  connected();
  await client.confirmConfiguration(serial, configuration.profile_request_id);
  connected();
  return record;
}
