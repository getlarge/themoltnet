import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  type CommandResult,
  type CommandSpec,
  publishExactVersion,
} from './npm-publish-exact';

const published = (version = '1.2.3'): CommandResult => ({
  exitCode: 0,
  stdout: `"${version}"\n`,
  stderr: '',
});
const missing: CommandResult = {
  exitCode: 1,
  stdout: '',
  stderr: 'npm error code E404\nnpm error 404 Not Found',
};
const publishSucceeded: CommandResult = {
  exitCode: 0,
  stdout: '+ @scope/package@1.2.3',
  stderr: '',
};

function sequenceRunner(results: CommandResult[]) {
  const commands: CommandSpec[] = [];
  const runner = vi.fn(async (command: CommandSpec) => {
    commands.push(command);
    const result = results.shift();
    if (!result) throw new Error('Unexpected command');
    return result;
  });
  return { commands, runner };
}

describe('exact npm publication', () => {
  it('skips an exact version that is already published', async () => {
    const { commands, runner } = sequenceRunner([published()]);

    const result = await publishExactVersion(
      { packageName: '@scope/package', version: '1.2.3' },
      runner,
    );

    expect(result).toEqual({
      state: 'already-published',
      publishAttempts: 0,
    });
    expect(commands.map(({ command }) => command)).toEqual(['npm']);
  });

  it('publishes only after an exact-version 404', async () => {
    const { commands, runner } = sequenceRunner([missing, publishSucceeded]);

    const result = await publishExactVersion(
      { packageName: '@scope/package', version: '1.2.3' },
      runner,
    );

    expect(result).toEqual({ state: 'published', publishAttempts: 1 });
    expect(commands.map(({ command }) => command)).toEqual(['npm', 'pnpm']);
  });

  it('reconciles an ambiguous failed publish before another upload', async () => {
    const ambiguousPublish: CommandResult = {
      exitCode: 1,
      stdout: '',
      stderr: 'socket closed before the registry response arrived',
    };
    const { commands, runner } = sequenceRunner([
      missing,
      ambiguousPublish,
      published(),
    ]);

    const result = await publishExactVersion(
      {
        packageName: '@scope/package',
        version: '1.2.3',
        retryDelayMs: 0,
      },
      runner,
      vi.fn(async () => undefined),
    );

    expect(result).toEqual({ state: 'reconciled', publishAttempts: 1 });
    expect(commands.map(({ command }) => command)).toEqual([
      'npm',
      'pnpm',
      'npm',
    ]);
  });

  it('fails closed when registry state is unavailable', async () => {
    const outage: CommandResult = {
      exitCode: 1,
      stdout: '',
      stderr: 'npm error code E503\nnpm error registry unavailable',
    };
    const { commands, runner } = sequenceRunner([outage]);

    await expect(
      publishExactVersion(
        { packageName: '@scope/package', version: '1.2.3' },
        runner,
      ),
    ).rejects.toThrow(/Unable to determine npm registry state/);
    expect(commands.map(({ command }) => command)).toEqual(['npm']);
  });

  it('keeps promotion gated when the exact-version scanner fails', () => {
    const workspaceRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../..',
    );
    const workflow = readFileSync(
      resolve(workspaceRoot, '.github/workflows/release.yml'),
      'utf8',
    );

    expect(workflow).toMatch(
      /promote-n8n-nodes-moltnet:[\s\S]*needs\.scan-n8n-nodes-moltnet\.result == 'success'/,
    );
  });
});
