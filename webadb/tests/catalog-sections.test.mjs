import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogSections, catalogStatus } from '../public/mdm-model.js';

const prepared = {
  apk_url: 'https://example.invalid/app.apk', sha256: 'a'.repeat(64), version_code: 2
};

test('catalog status distinguishes published, incomplete and hidden releases', () => {
  assert.equal(catalogStatus({ enabled: true, ...prepared }), 'available');
  assert.equal(catalogStatus({ enabled: true, ...prepared, sha256: '' }), 'preparing');
  assert.equal(catalogStatus({ enabled: true, ...prepared, version_code: 0 }), 'preparing');
  assert.equal(catalogStatus({ enabled: false, ...prepared }), 'hidden');
  assert.equal(catalogStatus({ enabled: false }), 'hidden');
});

test('catalog sections retain the real audience and combine status with search', () => {
  const apps = [
    { id: 'base', name: 'Base reader', package_name: 'org.example.reader', enabled: true, is_base: true, ...prepared },
    { id: 'private', name: 'Notes', description: 'Personal reader', package_name: 'org.example.notes', enabled: true, is_base: false },
    { id: 'hidden', name: 'Hidden reader', package_name: 'org.example.hidden', enabled: false, is_base: true, ...prepared }
  ];
  const original = structuredClone(apps);
  assert.deepEqual(catalogSections(apps).map(section => [section.key, section.apps.map(app => app.id)]),
    [['base', ['base', 'hidden']], ['selection', ['private']]]);
  assert.deepEqual(catalogSections(apps, ' READER ', 'available')[0].apps.map(app => app.id), ['base']);
  assert.deepEqual(catalogSections(apps, 'ORG.EXAMPLE.NOTES', 'preparing')[0].apps.map(app => app.id), ['private']);
  assert.equal(catalogSections(apps, 'reader', 'hidden')[0].apps[0].id, 'hidden');
  assert.deepEqual(catalogSections(apps, 'missing'), []);
  assert.deepEqual(catalogSections([], '', 'all'), []);
  assert.deepEqual(apps, original, 'Filtering must not change published apps or their audience');
});
