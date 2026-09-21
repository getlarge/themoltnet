import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const root = process.env.MOLTNET_DESKTOP_E2E_FIXTURE_ROOT;
if (
  !root ||
  process.env.HOME !== join(root, 'home') ||
  process.env.MOLTNET_HOME !== join(root, 'store') ||
  process.env.MOLTNET_AGENT_HOME !== join(root, 'agent')
) {
  throw new Error('Use the isolated e2e:native launcher');
}

export const config = {
  runner: 'local',
  specs: ['./native.spec.ts'],
  maxInstances: 1,
  framework: 'mocha',
  reporters: ['spec'],
  logLevel: 'info',
  mochaOpts: { timeout: 30_000 },
  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath:
          process.env.MOLTNET_DESKTOP_E2E_BINARY ??
          `${projectRoot}/out-rust/e2e/debug/bundle/macos/MoltNet Agent E2E.app/Contents/MacOS/moltnet-agent-desktop`,
        driverProvider: 'embedded',
        embeddedPort: Number(process.env.MOLTNET_DESKTOP_WEBDRIVER_PORT),
      },
    ],
  ],
  capabilities: [{ browserName: 'tauri' }],
};
