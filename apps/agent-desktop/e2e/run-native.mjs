import process from 'node:process';
import { spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'moltnet-desktop-e2e-'));
try {
  const home = join(root, 'home');
  mkdirSync(home, { mode: 0o700 });
  const current = join(root, 'agent/current');
  mkdirSync(join(current, 'bin'), { recursive: true });
  const version = readFileSync(
    join(projectRoot, 'agent-cli.version'),
    'utf8',
  ).trim();
  writeFileSync(join(current, 'manifest.json'), JSON.stringify({ version }));
  const shellQuote = (value) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  const tsx = fileURLToPath(
    new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url),
  );
  const fixture = fileURLToPath(
    new URL('../../agent-daemon/e2e/desktop-fixture.ts', import.meta.url),
  );
  writeFileSync(
    join(current, 'bin/moltnet-agent'),
    `#!/bin/sh
exec ${[process.execPath, tsx, fixture].map(shellQuote).join(' ')} "$@"
`,
    { mode: 0o700 },
  );
  const env = {
    ...process.env,
    HOME: home,
    MOLTNET_DESKTOP_E2E_FIXTURE_ROOT: root,
    MOLTNET_HOME: join(root, 'store'),
    MOLTNET_AGENT_HOME: join(root, 'agent'),
  };
  delete env.MOLTNET_AGENT_SERVER_ROOT;
  // A terminal's bundle identity must not be inherited by an AppKit application.
  delete env.__CFBundleIdentifier;
  // The embedded driver requires a fixed port, not an inherited listener.
  // This probe is not a reservation: a bind conflict must fail the run visibly.
  const portProbe = createServer();
  await new Promise((resolve, reject) => {
    portProbe.once('error', reject);
    portProbe.listen(0, '127.0.0.1', resolve);
  });
  env.MOLTNET_DESKTOP_WEBDRIVER_PORT = String(portProbe.address().port);
  env.TAURI_WEBDRIVER_PORT = env.MOLTNET_DESKTOP_WEBDRIVER_PORT;
  await new Promise((resolve, reject) =>
    portProbe.close((error) => (error ? reject(error) : resolve())),
  );
  const child = spawn(
    'pnpm',
    ['exec', 'wdio', 'run', 'e2e/wdio.native.conf.ts'],
    {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
    },
  );
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => child.kill(signal));
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}
