import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const distPath = join(import.meta.dirname, '..', 'dist', 'index.js');
const dist = readFileSync(distPath, 'utf8');

for (const dependency of ['@themoltnet/pi-runtime', '@themoltnet/sdk']) {
  if (!dist.includes(`from "${dependency}"`)) {
    process.stderr.write(
      `FAIL: pi-extension must import the published ${dependency} package\n`,
    );
    process.exit(1);
  }
}

if (/web-tree-sitter\.wasm|tree-sitter-bash\.wasm/.test(dist)) {
  process.stderr.write(
    'FAIL: pi-extension bundled pi-runtime and detached analyzer WASM asset paths\n',
  );
  process.exit(1);
}

process.stdout.write(
  'OK: pi-extension preserves published runtime boundaries\n',
);
