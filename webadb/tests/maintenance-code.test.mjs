import test from 'node:test';
import assert from 'node:assert/strict';
import { mountMaintenanceCode } from '../src/maintenance-code.js';

function element() {
  return {
    children: [],
    textContent: '',
    append(...children) { this.children.push(...children); },
    setAttribute() {}
  };
}

test('the maintenance code is loaded on request and cleared on leaving the panel', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-12T12:00:00Z'));
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: element };
  t.after(() => { globalThis.document = previousDocument; });

  const host = { ...element(), isConnected: true };
  let requests = 0;
  const dispose = mountMaintenanceCode(host, 'fr', async () => {
    requests++;
    return { code: 'A1B2C3', date: '2026-11-12' };
  });
  t.after(dispose);
  const [, button, result] = host.children;
  assert.equal(requests, 0);
  assert.equal(result.hidden, true);
  await button.onclick();
  assert.equal(requests, 1);
  assert.equal(result.hidden, false);
  assert.equal(result.children[0].textContent, 'A1B2C3');

  dispose();
  assert.equal(result.hidden, true);
  assert.equal(result.children[0].textContent, '');
  assert.equal(button.onclick, null);
});
