import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalStoreRoot, resolveStoreRoot } from '@themoltnet/sdk/node';

export function desktopDevelopmentEnvironment(
  env: NodeJS.ProcessEnv,
  workspaceRoot: string,
  home: string,
  cwd = workspaceRoot,
): NodeJS.ProcessEnv {
  const workspace = createHash('sha256')
    .update(canonicalStoreRoot(workspaceRoot))
    .digest('hex')
    .slice(0, 16);
  const development = join(
    home,
    '.local',
    'share',
    'moltnet',
    'development',
    workspace,
  );
  // Development requires its own explicit selectors; inherited production
  // store/install variables must never redirect a dev launch.
  const root = resolveStoreRoot({
    root: env.MOLTNET_DEV_HOME ?? join(development, 'store'),
    env: {},
    home,
    cwd,
  });
  const installation = canonicalStoreRoot(
    env.MOLTNET_DEV_AGENT_HOME ?? join(development, 'agent'),
    cwd,
  );
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    MOLTNET_HOME: root,
    MOLTNET_AGENT_HOME: installation,
    MOLTNET_AGENT_BIN_DIR: join(installation, 'bin'),
  };
  delete childEnv.MOLTNET_AGENT_SERVER_ROOT;
  return childEnv;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command, ...args] = process.argv.slice(2);
  if (!command) throw new Error('Supply the development command to launch');
  const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: desktopDevelopmentEnvironment(
      process.env,
      workspaceRoot,
      homedir(),
      process.cwd(),
    ),
  });
  child.on('error', (error) => {
    throw error;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal));
  }
}
