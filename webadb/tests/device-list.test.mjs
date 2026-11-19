import test from 'node:test';
import assert from 'node:assert/strict';
import { filterDeviceList } from '../src/device-list.js';

const devices = [
  { id: 'a-ready', client_id: 'a', platform: 'Android', configuration_status: 'configured' },
  { id: 'a-pending', client_id: 'a', platform: 'Android', configuration_status: 'needs_configuration' },
  { id: 'b-ready', client_id: 'b', platform: 'Android', configuration_status: 'configured' },
  { id: 'unassigned', client_id: null, platform: 'Android', configuration_status: 'configured' },
  { id: 'a-other', client_id: 'a', platform: 'Windows', configuration_status: 'needs_configuration' },
  { id: 'unknown-state', platform: 'Android' }
];
const ids = values => values.map(device => device.id);

test('client, platform and preparation filters compose without matching another client', () => {
  assert.deepEqual(ids(filterDeviceList(devices, { clientId: 'a', platform: 'Android' })), ['a-ready', 'a-pending']);
  assert.deepEqual(ids(filterDeviceList(devices, { clientId: 'a', platform: 'Android', readiness: 'ready' })), ['a-ready']);
  assert.deepEqual(ids(filterDeviceList(devices, { clientId: 'a', readiness: 'pending' })), ['a-pending', 'a-other']);
  assert.deepEqual(filterDeviceList(devices, { clientId: 'removed-client' }), []);
});

test('unassigned includes absent assignments while unknown preparation stays outside ready and pending', () => {
  assert.deepEqual(ids(filterDeviceList(devices, { clientId: 'unassigned' })), ['unassigned', 'unknown-state']);
  assert.deepEqual(ids(filterDeviceList(devices, { clientId: 'unassigned', readiness: 'ready' })), ['unassigned']);
  assert.deepEqual(filterDeviceList(devices, { clientId: 'unassigned', readiness: 'pending' }), []);
  assert.deepEqual(filterDeviceList(devices), devices);
});
