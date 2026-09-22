import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { processEnvSnapshot } from '../config.js';

it('survives a late SIGTERM while supervised EOF shutdown releases its store lock', async () => {
  const root = mkdtempSync(join(tmpdir(), 'server-shutdown-'));
  const child = spawn(
    process.execPath,
    [
      '--import',
      join(import.meta.dirname, '../../test-fixtures/hold-lock-release.mjs'),
      '--import',
      'tsx',
      join(import.meta.dirname, '../main.ts'),
      'server',
      '--supervised',
      '--port',
      '0',
      '--root',
      root,
    ],
    {
      stdio: ['pipe', 'ignore', 'pipe', 'ipc'],
      env: {
        PATH: processEnvSnapshot().PATH,
        HOME: root,
        MOLTNET_HOME: root,
        MOLTNET_AGENT_SERVER_NATIVE_TOKEN:
          randomBytes(32).toString('base64url'),
        NX_LOAD_DOT_ENV_FILES: 'false',
      },
    },
  );
  const exited = once(child, 'exit') as Promise<
    [number | null, NodeJS.Signals | null]
  >;
  let observeSignal = () => {};
  const signalHandled = new Promise<void>((resolve) => {
    observeSignal = resolve;
  });
  let logs = '';
  child.stderr!.on('data', (chunk: Buffer) => {
    logs += chunk.toString();
    if (logs.includes('shutting down: stopping runs')) observeSignal();
    if (logs.includes('moltnet-agent server listening on')) child.stdin!.end();
  });
  try {
    const releasing = once(child, 'message', {
      signal: AbortSignal.timeout(45_000),
    }) as Promise<[unknown]>;
    const first = await Promise.race([
      releasing.then(([message]) => message),
      exited.then(([code, signal]) => {
        throw new Error(`Premature exit ${code ?? signal}: ${logs}`);
      }),
    ]);
    expect(first).toBe('releasing-lock');
    expect(logs).toContain('moltnet-agent server listening on');
    expect(existsSync(join(root, 'agent-server.lock'))).toBe(true);
    child.kill('SIGTERM');
    await Promise.race([
      signalHandled,
      exited.then(() => {
        throw new Error(
          `Signal terminated the daemon before lock release: ${logs}`,
        );
      }),
    ]);
    // The IPC message releases a deliberately blocked filesystem operation.
    // An old supervisor with already-removed handlers dies from SIGTERM here.
    child.send('release-lock');
    const [code, signal] = await exited;
    expect(signal, logs).toBeNull();
    expect([0, 143]).toContain(code);
    expect(existsSync(join(root, 'agent-server.lock')), logs).toBe(false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
