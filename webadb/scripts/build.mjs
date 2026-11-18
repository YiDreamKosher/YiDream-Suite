import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const argument = name => args[args.indexOf(name) + 1];
const outdir = args.includes('--outdir') ? resolve(argument('--outdir')) : resolve(root, 'dist');
// Output removal is limited to a separate generated directory.
const insideRoot = relative(root, outdir);
if (outdir === root || root.startsWith(outdir + sep) ||
    (!insideRoot.startsWith('..' + sep) && insideRoot !== '..' && !isAbsolute(insideRoot) && outdir !== resolve(root, 'dist'))) {
  throw new Error('Use dist or a separate temporary output directory.');
}

const environment = {};
for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  try { Object.assign(environment, parseEnv(await readFile(resolve(root, name), 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
Object.assign(environment, process.env);
const define = {
  'import.meta.env.DEV': 'false',
  'import.meta.env.PROD': 'true',
  'import.meta.env.BASE_URL': JSON.stringify('./')
};
// Only these existing public settings can enter the browser bundle.
for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
  define['import.meta.env.' + key] = JSON.stringify(environment[key] || '');
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await cp(resolve(root, 'public'), outdir, { recursive: true });
await cp(resolve(root, 'assets'), resolve(outdir, 'assets'), { recursive: true });

const pages = [
  ['index.html', 'src/main.js'],
  ['admin.html', 'src/admin-console.js'],
  ['admin/index.html', 'src/admin-console.js']
];
const outputPath = path => isAbsolute(path) ? path : resolve(root, path);
const urlFrom = (page, output) => {
  const path = relative(dirname(resolve(outdir, page)), outputPath(output)).split(sep).join('/');
  return path.startsWith('.') ? path : './' + path;
};

const html = {
  name: 'static-html-entries',
  setup(builder) {
    builder.onEnd(async result => {
      if (result.errors.length) return;
      for (const [page, entry] of pages) {
        const output = Object.entries(result.metafile.outputs).find(([, info]) => info.entryPoint === entry);
        if (!output) throw new Error('Missing entry ' + entry);
        const [script, metadata] = output;
        let content = await readFile(resolve(root, page), 'utf8');
        const source = page.includes('/') ? '../' + entry : './' + entry;
        if (!content.includes('src="' + source + '"')) throw new Error('Missing module reference in ' + page);
        content = content.replace('src="' + source + '"', 'src="' + urlFrom(page, script) + '"');
        if (metadata.cssBundle) {
          content = content.replace('</head>', '<link rel="stylesheet" href="' + urlFrom(page, metadata.cssBundle) + '">\n</head>');
        }
        await mkdir(dirname(resolve(outdir, page)), { recursive: true });
        await writeFile(resolve(outdir, page), content);
      }
      console.log('Built Suite, admin.html and admin/ with shared modules.');
    });
  }
};

const options = {
  absWorkingDir: root,
  entryPoints: { suite: 'src/main.js', 'admin-console': 'src/admin-console.js' },
  outdir,
  entryNames: 'assets/[name]-[hash]',
  chunkNames: 'assets/shared-[hash]',
  assetNames: 'assets/[name]-[hash]',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  metafile: true,
  loader: { '.png': 'file' },
  define,
  plugins: [html]
};

if (args.includes('--serve')) {
  const builder = await context(options);
  await builder.rebuild();
  await builder.watch();
  const port = args.includes('--port') ? Number(argument('--port')) : 5173;
  const server = await builder.serve({ servedir: outdir, host: '127.0.0.1', port });
  console.log('Local: http://127.0.0.1:' + server.port + '/');
  const stop = async () => { await builder.dispose(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} else {
  await build(options);
}
