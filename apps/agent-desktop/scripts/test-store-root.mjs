// Run the std-only resolver on each native platform without Tauri GUI dependencies.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const temporary = mkdtempSync(join(tmpdir(), 'moltnet-store-conformance-'));
const binary = join(temporary, 'store-root-tests.exe');
const source = fileURLToPath(
  new URL('../src-tauri/src/store_root.rs', import.meta.url),
);
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.signal ?? result.status})`);
  }
}
try {
  run('rustc', ['--edition=2021', '--test', source, '-o', binary]);
  // Runtime filesystem skip reasons must be visible on case-sensitive runners.
  run(binary, ['--nocapture']);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
