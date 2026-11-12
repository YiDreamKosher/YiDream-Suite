import { deviceCopy } from './device-control-copy.js';

export function mountMaintenanceCode(host, language, fetchCode) {
  const copy = key => deviceCopy(language, key);
  const hint = document.createElement('p');
  hint.textContent = copy('maintenanceHint');
  const show = document.createElement('button');
  show.type = 'button';
  show.className = 'button primary';
  show.textContent = copy('maintenanceReveal');
  const result = document.createElement('p');
  result.hidden = true;
  result.setAttribute('aria-live', 'polite');
  const code = document.createElement('code');
  code.dir = 'ltr';
  code.className = 'maintenance-code-value';
  const date = document.createElement('span');
  result.append(code, date);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  host.append(hint, show, result, status);

  let disposed = false;
  let expiry;
  function clearCode() {
    clearTimeout(expiry);
    code.textContent = '';
    date.textContent = '';
    result.hidden = true;
  }

  show.onclick = async () => {
    if (disposed || show.disabled) return;
    clearCode();
    show.disabled = true;
    status.textContent = copy('wait');
    try {
      const value = await fetchCode();
      if (disposed || !host.isConnected) return;
      if (typeof value?.code !== 'string' || !/^[0-9A-F]{6}$/.test(value.code) ||
          typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) {
        throw new Error('INVALID_MAINTENANCE_CODE');
      }
      const dateStart = Date.parse(value.date + 'T00:00:00Z');
      const remaining = dateStart + 86_400_000 - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 86_400_000) {
        throw new Error('INVALID_MAINTENANCE_DATE');
      }
      code.textContent = value.code;
      date.textContent = ' · ' + copy('maintenanceDate') + ' ' + value.date;
      result.hidden = false;
      status.textContent = '';
      expiry = setTimeout(clearCode, remaining);
    } catch {
      if (!disposed && host.isConnected) status.textContent = copy('maintenanceUnavailable');
    } finally {
      if (!disposed) show.disabled = false;
    }
  };
  return () => {
    disposed = true;
    clearCode();
    status.textContent = '';
    show.onclick = null;
  };
}
