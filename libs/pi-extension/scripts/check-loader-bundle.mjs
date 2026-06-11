import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const distPath = join(import.meta.dirname, '..', 'dist', 'index.js');
const dist = readFileSync(distPath, 'utf8');

const externalTypeboxImport =
  /(?:from\s*['"]typebox(?:\/[^'"]*)?['"]|import\s*\(\s*['"]typebox(?:\/[^'"]*)?['"]|require\s*\(\s*['"]typebox(?:\/[^'"]*)?['"])/;

if (externalTypeboxImport.test(dist)) {
  process.stderr.write(
    'FAIL: pi-extension dist/index.js must bundle TypeBox; external typebox imports hit Pi loader alias bugs\n',
  );
  process.exit(1);
}

process.stdout.write(
  'OK: pi-extension bundles TypeBox for Pi loader compatibility\n',
);
