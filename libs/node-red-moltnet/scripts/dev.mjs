#!/usr/bin/env node
/**
 * Dev runner: build the nodes, link this package into a local Node-RED
 * userDir, and start Node-RED 5 with the MoltNet nodes loaded.
 *
 *   pnpm --filter @themoltnet/node-red-moltnet dev      # http://localhost:1880
 *   PORT=1881 pnpm --filter @themoltnet/node-red-moltnet dev
 *
 * The nodes are self-contained (SDK bundled), so no extra install is needed in
 * the userDir. After editing a node, stop (Ctrl-C) and re-run to rebuild +
 * reload — Node-RED does not hot-reload custom nodes.
 */
import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const userDir = resolve(pkgDir, '.node-red-dev');
const port = process.env.PORT ?? '1880';

// 1. Build the nodes (dist/nodes/*.{js,html})
console.log('▸ building nodes…');
execSync('pnpm exec vite build', { cwd: pkgDir, stdio: 'inherit' });

// 2. Mark the userDir as CommonJS so Node-RED's generated settings.js loads
//    (this package is "type":"module", which would otherwise leak in).
mkdirSync(userDir, { recursive: true });
writeFileSync(
  resolve(userDir, 'package.json'),
  JSON.stringify(
    { name: 'node-red-moltnet-dev', private: true, type: 'commonjs' },
    null,
    2,
  ),
);

// 3. Link this package into the userDir so Node-RED discovers it
const scope = resolve(userDir, 'node_modules', '@themoltnet');
const link = resolve(scope, 'node-red-moltnet');
mkdirSync(scope, { recursive: true });
if (existsSync(link)) rmSync(link, { recursive: true, force: true });
symlinkSync(pkgDir, link, 'dir');
console.log(`▸ linked @themoltnet/node-red-moltnet → ${userDir}`);

// 4. Run Node-RED 5 (downloaded on first run via npx, then cached)
console.log(`▸ starting Node-RED on http://localhost:${port} …`);
execSync(`npx -y node-red@5 --userDir "${userDir}" -p ${port}`, {
  cwd: pkgDir,
  stdio: 'inherit',
});
