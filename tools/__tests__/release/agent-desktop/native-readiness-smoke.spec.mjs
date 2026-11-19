import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, test } from 'vitest';

const smoke = resolve(
  import.meta.dirname,
  '../../../release/agent-desktop/native-readiness-smoke.sh',
);
let directory;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'desktop-smoke-test-'));
  const bin = join(directory, 'dist/agent-bundle/moltnet-agent-fixture/bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'moltnet-agent'), '#!/bin/sh\nexit 0\n', {
    mode: 0o755,
  });
  mkdirSync(join(directory, 'os-temp'));
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function launch(body) {
  const desktop = join(directory, 'desktop');
  writeFileSync(
    desktop,
    `#!/bin/sh
mkdir -p "$HOME/.config/moltnet/agent-server/logs"
log="$HOME/.config/moltnet/agent-server/logs/desktop-supervisor.log"
${body}
`,
    { mode: 0o755 },
  );
  return spawnSync('bash', [smoke, 'fixture', desktop], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 5_000,
    env: {
      ...process.env,
      TMPDIR: join(directory, 'os-temp'),
      MOLTNET_DESKTOP_SMOKE_LOG_DIR: join(directory, 'retained'),
    },
  });
}

function assertHomeRemoved() {
  assert.deepEqual(readdirSync(join(directory, 'os-temp')), []);
}

test('retains launcher and supervisor diagnostics outside TMPDIR on failure', () => {
  const result = launch(
    'echo "launcher diagnostic"\necho "child startup diagnostic" > "$log"\nexit 1',
  );
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /did not start its managed native-socket server/);
  assert.match(
    readFileSync(
      join(directory, 'retained/moltnet-desktop-smoke-fixture.log'),
      'utf8',
    ),
    /launcher diagnostic/,
  );
  assert.match(
    readFileSync(
      join(directory, 'retained/moltnet-desktop-smoke-fixture-supervisor.log'),
      'utf8',
    ),
    /child startup diagnostic/,
  );
  assertHomeRemoved();
});

test('removes successful smoke output and the isolated HOME', () => {
  const result = launch('echo "native control socket: ready" > "$log"\nexit 0');
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    existsSync(join(directory, 'retained/moltnet-desktop-smoke-fixture.log')),
    false,
  );
  assert.deepEqual(readdirSync(join(directory, 'retained')), []);
  assertHomeRemoved();
});
