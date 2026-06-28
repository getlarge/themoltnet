import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');

mkdirSync(resolve(packageRoot, 'dist'), { recursive: true });
copyFileSync(
  resolve(packageRoot, 'src/moltnet-node-red-theme.css'),
  resolve(packageRoot, 'dist/moltnet-node-red-theme.css'),
);
