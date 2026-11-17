// Runs actionlint at the version pinned in `tools/actionlint/go.mod`.
//
// actionlint is a Go program, so it is declared as a Go `tool` dependency
// rather than fetched through an npm wrapper. `go tool -n` builds it into the
// Go build cache on first use and prints the cached binary's path, which then
// runs from the caller's directory so workflow paths and
// `.github/actionlint.yaml` resolve as usual. The module sits outside go.work,
// hence GOWORK=off.
//
// Usage: node tools/src/actionlint.ts [actionlint flags] [files...]

import { execFileSync, spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const moduleDir = fileURLToPath(new URL('../actionlint', import.meta.url));
const env = { ...process.env, GOWORK: 'off' };

const binary = execFileSync(
  'go',
  ['-C', moduleDir, 'tool', '-n', 'actionlint'],
  { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'inherit'] },
).trim();

const result = spawnSync(binary, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
