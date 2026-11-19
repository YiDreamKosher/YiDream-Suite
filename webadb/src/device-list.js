/** Filters only the device records already authorized and loaded for this workspace. */
export function filterDeviceList(devices, { platform = '', readiness = '', clientId = '' } = {}) {
  return devices.filter(device => {
    if (platform && device.platform !== platform) return false;
    if (clientId === 'unassigned' ? Boolean(device.client_id) : clientId && device.client_id !== clientId) return false;
    if (readiness === 'pending' && device.configuration_status !== 'needs_configuration') return false;
    if (readiness === 'ready' && device.configuration_status !== 'configured') return false;
    return true;
  });
}
