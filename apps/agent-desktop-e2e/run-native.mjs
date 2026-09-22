import process from 'node:process';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
if (!['darwin', 'linux'].includes(process.platform))
  throw new Error('Native Desktop journeys require macOS or Linux');
const abort = new globalThis.AbortController();
let child;
const terminate = (signal) => {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
};
const onInterrupt = () => {
  process.exitCode = 130;
  abort.abort();
  terminate('SIGINT');
};
const onTerminate = () => {
  process.exitCode = 143;
  abort.abort();
  terminate('SIGTERM');
};
process.once('SIGINT', onInterrupt);
process.once('SIGTERM', onTerminate);
const root = realpathSync(mkdtempSync(join(tmpdir(), 'moltnet-desktop-e2e-')));
try {
  const home = join(root, 'home');
  mkdirSync(home, { mode: 0o700 });
  const current = join(root, 'agent/current');
  mkdirSync(join(current, 'bin'), { recursive: true });
  // Match the embedded development default so startup keeps the local CLI.
  const version = readFileSync(
    new URL('../agent-desktop/agent-cli.minimum-version', import.meta.url),
    'utf8',
  ).trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))
    throw new Error('Invalid Desktop minimum agent version');
  writeFileSync(join(current, 'manifest.json'), JSON.stringify({ version }));
  const shellQuote = (value) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  const tsx = import.meta.resolve('tsx');
  const fixture = fileURLToPath(
    new URL('../agent-daemon/src/main.ts', import.meta.url),
  );
  writeFileSync(
    join(current, 'bin/moltnet-agent'),
    `#!/bin/sh
exec ${[process.execPath, '--import', tsx, fixture].map(shellQuote).join(' ')} "$@"
`,
    { mode: 0o700 },
  );
  // Inherit only host process essentials; selectors, credentials, XDG paths,
  // and encrypted dotenv values must not escape into this disposable installation.
  const env = Object.fromEntries(
    ['PATH', 'LANG', 'LC_ALL', 'TERM', 'DISPLAY'].flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]]],
    ),
  );
  Object.assign(env, {
    TMPDIR: realpathSync(tmpdir()),
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_DATA_HOME: join(home, '.local/share'),
    XDG_RUNTIME_DIR: join(home, '.runtime'),
    ...(process.platform === 'linux' ? { GDK_BACKEND: 'x11' } : {}),
    MOLTNET_DESKTOP_E2E_FIXTURE_ROOT: root,
    MOLTNET_HOME: join(root, 'store'),
    MOLTNET_AGENT_HOME: join(root, 'agent'),
    MOLTNET_API_URL: 'http://127.0.0.1:1',
    MOLTNET_OPERATOR_API_URL: 'http://127.0.0.1:1',
    MOLTNET_OPERATOR_OAUTH_ISSUER: 'http://127.0.0.1:1',
    MOLTNET_OPERATOR_OAUTH_PUBLIC_URL: 'http://127.0.0.1:1',
    NX_LOAD_DOT_ENV_FILES: 'false',
  });
  for (const path of [
    env.MOLTNET_HOME,
    env.XDG_CONFIG_HOME,
    env.XDG_CACHE_HOME,
    env.XDG_DATA_HOME,
    env.XDG_RUNTIME_DIR,
  ])
    mkdirSync(path, { recursive: true, mode: 0o700 });
  // Resolve and compile the real CLI before Desktop's bounded startup probe.
  // A cold TypeScript module graph is fixture preparation, not daemon readiness.
  const prepare = spawn(
    process.execPath,
    [
      '--import',
      tsx,
      fileURLToPath(new URL('../agent-daemon/src/main.ts', import.meta.url)),
      '--help',
    ],
    {
      cwd: projectRoot,
      env,
      stdio: 'ignore',
      signal: abort.signal,
      timeout: 60_000,
    },
  );
  await new Promise((resolve, reject) => {
    prepare.once('error', reject);
    prepare.once('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error('Fixture CLI preparation failed')),
    );
  });
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
  abort.signal.throwIfAborted();
  child = spawn(
    process.platform === 'linux' ? 'dbus-run-session' : process.execPath,
    [
      ...(process.platform === 'linux' ? ['--', process.execPath] : []),
      fileURLToPath(
        new URL('../bin/wdio.js', import.meta.resolve('@wdio/cli')),
      ),
      'run',
      'wdio.native.conf.ts',
    ],
    {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
      detached: true,
    },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) =>
      resolve(abort.signal.aborted ? process.exitCode : (code ?? 1)),
    );
  });
} catch (error) {
  if (!abort.signal.aborted) throw error;
} finally {
  // Reap the runner-owned process group before removing its configuration.
  terminate('SIGKILL');
  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onTerminate);
  if (process.exitCode) {
    const log = join(root, 'store/agent-server/logs/desktop-supervisor.log');
    if (existsSync(log)) {
      mkdirSync(join(projectRoot, 'test-results'), { recursive: true });
      writeFileSync(
        join(projectRoot, 'test-results/supervisor.log'),
        readFileSync(log),
        { mode: 0o600 },
      );
    }
  }
  rmSync(root, { recursive: true, force: true });
}
