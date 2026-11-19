import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

function attribute(tag, name) {
  return new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)?.[2];
}

function localFile(outdir, htmlPath, reference) {
  assert.ok(reference && !/^(?:[a-z]+:|\/)/i.test(reference), `Expected a relative asset URL: ${reference}`);
  const path = resolve(dirname(htmlPath), decodeURIComponent(reference.split(/[?#]/)[0]));
  const within = relative(outdir, path);
  assert.ok(within && within !== '..' && !within.startsWith('..' + sep), `Asset escapes the site: ${reference}`);
  return path;
}

async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

test('production build serves all Suite entries, styles, assets and public tools', { timeout: 120_000 }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'yidream-site-build-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const outdir = join(temporary, 'site');
  const supabaseUrl = 'https://build-fixture.supabase.test';
  const publishableKey = 'sb_publishable_build_fixture';
  await exec(process.execPath, ['scripts/build.mjs', '--outdir', outdir], {
    cwd: root,
    env: { ...process.env, VITE_SUPABASE_URL: supabaseUrl, VITE_SUPABASE_ANON_KEY: publishableKey },
    timeout: 90_000,
    maxBuffer: 2 * 1024 * 1024
  });

  const entries = new Map();
  for (const name of ['index.html', 'admin.html', 'admin/index.html']) {
    const path = join(outdir, name);
    const html = await readFile(path, 'utf8');
    const modules = [...html.matchAll(/<script\b[^>]*>/gi)].map(match => match[0])
      .filter(tag => attribute(tag, 'type') === 'module' && attribute(tag, 'src'));
    assert.equal(modules.length, 1, `${name} must load one bundled entry`);
    const moduleReference = attribute(modules[0], 'src');
    assert.match(moduleReference, /(?:^|\/)assets\/[^/]+-[\w-]{6,}\.js$/, `${name} must use a hashed entry`);
    const modulePath = localFile(outdir, path, moduleReference);
    assert.ok((await stat(modulePath)).isFile(), `${name} entry must exist`);
    assert.doesNotMatch(html, /(?:src|href)\s*=\s*["'][^"']*(?:^|\/)src\//im, `${name} must not expose source modules`);

    const styles = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => match[0])
      .filter(tag => attribute(tag, 'rel') === 'stylesheet');
    if (name !== 'index.html') assert.ok(styles.length, `${name} must load the administration styles`);
    for (const tag of styles) {
      assert.ok((await stat(localFile(outdir, path, attribute(tag, 'href')))).isFile(), `${name} stylesheet must exist`);
    }
    for (const tag of [...html.matchAll(/<(?:img|link)\b[^>]*>/gi)].map(match => match[0])) {
      const reference = attribute(tag, 'src') || attribute(tag, 'href');
      if (!reference || /^(?:[a-z]+:|\/|#)/i.test(reference)) continue;
      assert.ok((await stat(localFile(outdir, path, reference))).isFile(), `${name} image or link asset must exist`);
    }
    entries.set(name, { modulePath, moduleReference });
  }
  assert.equal(entries.get('admin.html').modulePath, entries.get('admin/index.html').modulePath,
    'Both administrator URLs must share the same bundled entry');
  assert.match(entries.get('admin/index.html').moduleReference, /^\.\.\/assets\//,
    'The short administrator route must resolve assets from its parent');
  assert.notEqual(entries.get('index.html').modulePath, entries.get('admin.html').modulePath,
    'The legacy configurator and administrator console have separate entry points');

  for (const source of await filesIn(join(root, 'public'))) {
    const destination = join(outdir, relative(join(root, 'public'), source));
    assert.equal((await stat(destination)).size, (await stat(source)).size,
      `Public tool must be copied intact: ${relative(root, source)}`);
  }
  for (const name of ['assets/yidream-logo.png', 'assets/icons/yidream-admin.png']) {
    assert.deepEqual(await readFile(join(outdir, name)), await readFile(join(root, name)),
      `Unbundled HTML logo must remain available: ${name}`);
  }
  const builtFiles = await filesIn(join(outdir, 'assets'));
  for (const logo of ['yidream-logo', 'yidream-admin']) {
    assert.ok(builtFiles.some(path => new RegExp(`[/\\\\]${logo}-[\\w-]{6,}\\.png$`).test(path)),
      `Bundled ${logo} asset must be emitted`);
  }
  const scripts = await Promise.all(builtFiles.filter(path => path.endsWith('.js')).map(path => readFile(path, 'utf8')));
  assert.ok(scripts.length, 'The build must emit JavaScript');
  const javascript = scripts.join('\n');
  assert.doesNotMatch(javascript, /import\.meta\.env\b/, 'Browser code must not depend on build-time environment access');
  assert.ok(javascript.includes(supabaseUrl), 'The configured connection URL must be embedded');
  assert.ok(javascript.includes(publishableKey), 'The configured public connection key must be embedded');
});
