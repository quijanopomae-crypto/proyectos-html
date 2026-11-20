// Prepara la web independiente del Cliente 001 para Cloudflare Workers Assets.
// Solo escribe en _site (generado); no modifica el POS fuente ni la API.
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const webRoot = join(repoRoot, 'tools/cloudflare-pos-web');
const site = join(webRoot, '_site');
const app = join(site, 'app');

await rm(site, { recursive: true, force: true });
await mkdir(app, { recursive: true });
await cp(join(repoRoot, 'POS'), app, { recursive: true });
await cp(join(webRoot, 'public'), site, { recursive: true });

const stamp = createHash('sha256')
  .update((process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || '') + ':' + Date.now())
  .digest('hex')
  .slice(0, 12);

async function replaceBuildMarkers(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      await replaceBuildMarkers(file);
      continue;
    }
    if (!entry.isFile() || !['.html', '.js', '.json', '.webmanifest', '.css'].includes(extname(file))) continue;
    const original = await readFile(file, 'utf8');
    if (!original.includes('__BUILD_HASH__')) continue;
    await writeFile(file, original.replaceAll('__BUILD_HASH__', stamp), 'utf8');
  }
}
await replaceBuildMarkers(site);

// Personaliza el lanzador sin cambiar el codigo original del POS.
const launcher = join(site, 'index.html');
const html = await readFile(launcher, 'utf8');
await writeFile(launcher, html.replaceAll('Nuevo Amanecer POS', 'Cliente 001 POS'), 'utf8');

for (const required of ['index.html', 'activate.js', 'app/index.html', 'app/sw.js', 'app/js/sync/hosted-canonical-guard.js']) {
  await readFile(join(site, required));
}
console.log('Web Cliente 001 preparada en tools/cloudflare-pos-web/_site; build:', stamp);
