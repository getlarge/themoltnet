#!/usr/bin/env node
/**
 * Dev runner: link the already-built package into a local Node-RED userDir
 * and start Node-RED 5 with the MoltNet nodes loaded.
 *
 *   pnpm exec nx run @themoltnet/node-red-contrib-core:dev      # http://localhost:1880
 *   PORT=1881 pnpm exec nx run @themoltnet/node-red-contrib-core:dev
 *
 * The nodes are self-contained (SDK bundled), so no extra install is needed in
 * the userDir. Nx builds this package and the theme through the dev target's
 * dependsOn pipeline. After editing a node, stop (Ctrl-C) and re-run to
 * rebuild + reload — Node-RED does not hot-reload custom nodes.
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
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const themePkgDir = resolve(pkgDir, '../node-red-theme');
const userDir = resolve(pkgDir, '.node-red-dev');
const port = process.env.PORT ?? '1880';

const themeEntry = resolve(themePkgDir, 'dist/index.js');
const nodeEntry = resolve(pkgDir, 'dist/nodes/agent.js');
if (!existsSync(themeEntry) || !existsSync(nodeEntry)) {
  throw new Error(
    'Node-RED dev assets are missing. Run through Nx so target dependsOn builds the theme and nodes: ' +
      'pnpm exec nx run @themoltnet/node-red-contrib-core:dev',
  );
}

const { moltnetEditorTheme } = await import(pathToFileURL(themeEntry).href);
const editorTheme = moltnetEditorTheme({
  title: 'MoltNet Flow Studio',
});

// 1. Mark the userDir as CommonJS so Node-RED's settings.js loads
//    (this package is "type":"module", which would otherwise leak in).
mkdirSync(userDir, { recursive: true });
writeFileSync(
  resolve(userDir, 'package.json'),
  JSON.stringify(
    { name: 'node-red-contrib-core-dev', private: true, type: 'commonjs' },
    null,
    2,
  ),
);
writeFileSync(
  resolve(userDir, 'settings.js'),
  `module.exports = ${JSON.stringify({ editorTheme }, null, 2)};\n`,
);

// 2. Link this package into the userDir so Node-RED discovers it
const scope = resolve(userDir, 'node_modules', '@themoltnet');
const link = resolve(scope, 'node-red-contrib-core');
mkdirSync(scope, { recursive: true });
if (existsSync(link)) rmSync(link, { recursive: true, force: true });
symlinkSync(pkgDir, link, 'dir');
console.log(`▸ linked @themoltnet/node-red-contrib-core → ${userDir}`);
console.log(
  `▸ applied @themoltnet/node-red-theme from ${editorTheme.page.css}`,
);

// 3. Run Node-RED 5 (downloaded on first run via npx, then cached)
console.log(`▸ starting Node-RED on http://localhost:${port} …`);
execSync(`npx -y node-red@5 --userDir "${userDir}" -p ${port}`, {
  cwd: pkgDir,
  stdio: 'inherit',
});
