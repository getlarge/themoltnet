import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureFailure } from './src/failure-artifacts.js';

const projectRoot = fileURLToPath(new URL('../agent-desktop', import.meta.url));
const root = process.env.MOLTNET_DESKTOP_E2E_FIXTURE_ROOT;
if (
  !root ||
  process.env.HOME !== join(root, 'home') ||
  process.env.MOLTNET_HOME !== join(root, 'store') ||
  process.env.MOLTNET_AGENT_HOME !== join(root, 'agent')
) {
  throw new Error('Use the agent-desktop-e2e e2e target');
}

export const config = {
  afterTest: captureFailure,
  onPrepare() {
    mkdirSync('test-results', { recursive: true });
  },
  runner: 'local',
  specs: ['./src/native.spec.ts'],
  maxInstances: 1,
  framework: 'mocha',
  reporters: ['spec'],
  logLevel: 'warn',
  mochaOpts: {
    // Persistence journeys perform two bounded starts and shutdown.
    timeout: 60_000,
  },
  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath:
          process.platform === 'darwin'
            ? `${projectRoot}/out-rust/e2e/debug/bundle/macos/MoltNet Agent E2E.app/Contents/MacOS/moltnet-agent-desktop`
            : `${projectRoot}/out-rust/e2e/debug/moltnet-agent-desktop`,
        driverProvider: 'embedded',
        embeddedPort: Number(process.env.MOLTNET_DESKTOP_WEBDRIVER_PORT),
      },
    ],
  ],
  capabilities: [{ browserName: 'tauri' }],
};
