import process from 'node:process';
import { execFileSync } from 'node:child_process';
execFileSync(
  'pnpm',
  [
    '--dir',
    'apps/agent-desktop',
    'exec',
    'tauri',
    'build',
    '--debug',
    ...(process.platform === 'darwin' ? ['--bundles', 'app'] : ['--no-bundle']),
    '--features',
    'desktop-e2e',
    '--config',
    'src-tauri/tauri.e2e.conf.json',
  ],
  {
    env: { ...process.env, CARGO_TARGET_DIR: '../out-rust/e2e' },
    stdio: 'inherit',
  },
);
