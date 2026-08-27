import { describe, expect, it } from 'vitest';

import { executeCommand } from './command.js';

describe('sandbox policy command execution', () => {
  it('returns trustworthy zero and non-zero process exits', async () => {
    await expect(
      executeCommand(process.execPath, ['-e', "process.stdout.write('ok')"]),
    ).resolves.toEqual({ exitCode: 0, stdout: 'ok', stderr: '' });

    await expect(
      executeCommand(process.execPath, [
        '-e',
        "process.stderr.write('denied'); process.exit(7)",
      ]),
    ).resolves.toEqual({ exitCode: 7, stdout: '', stderr: 'denied' });
  });

  it('forwards an explicit environment to the child process', async () => {
    await expect(
      executeCommand(
        process.execPath,
        ['-e', "process.stdout.write(process.env.MOLTNET_TEST_ENV ?? '')"],
        { env: { ...process.env, MOLTNET_TEST_ENV: 'isolated' } },
      ),
    ).resolves.toMatchObject({ exitCode: 0, stdout: 'isolated' });
  });

  it('rejects timeout, abort, spawn, and output-overflow failures distinctly', async () => {
    await expect(
      executeCommand(
        process.execPath,
        ['-e', 'setTimeout(() => undefined, 10_000)'],
        { timeoutMs: 5 },
      ),
    ).rejects.toMatchObject({ kind: 'timed-out' });

    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(
      executeCommand(
        process.execPath,
        ['-e', 'setTimeout(() => undefined, 10_000)'],
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ kind: 'aborted' });

    await expect(
      executeCommand('moltnet-command-that-does-not-exist', []),
    ).rejects.toMatchObject({ kind: 'spawn-error' });

    await expect(
      executeCommand(process.execPath, [
        '-e',
        "process.stdout.write('x'.repeat(1024 * 1024 + 1))",
      ]),
    ).rejects.toMatchObject({
      kind: 'output-overflow',
    });
  });
});
