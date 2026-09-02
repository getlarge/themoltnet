import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  type CommandResult,
  type CommandSpec,
  publishExactVersion,
} from './npm-publish-exact';
import { runCommand } from './npm-publish-exact.cli';

const expectedIntegrity = 'sha512-Zml4dHVyZQ==';
const publishOptions = {
  packageName: '@scope/package',
  version: '1.2.3',
  expectedIntegrity,
};
const published = (integrity = expectedIntegrity): CommandResult => ({
  exitCode: 0,
  stdout: `${JSON.stringify(integrity)}\n`,
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

    const result = await publishExactVersion(publishOptions, runner);

    expect(result).toEqual({
      state: 'already-published',
      publishAttempts: 0,
    });
    expect(commands.map(({ command }) => command)).toEqual(['npm']);
  });

  it('publishes only after an exact-version 404', async () => {
    const { commands, runner } = sequenceRunner([missing, publishSucceeded]);

    const result = await publishExactVersion(publishOptions, runner);

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
        ...publishOptions,
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

    await expect(publishExactVersion(publishOptions, runner)).rejects.toThrow(
      /Unable to determine npm registry state/,
    );
    expect(commands.map(({ command }) => command)).toEqual(['npm']);
  });

  it('fails closed when the published tarball integrity differs', async () => {
    const { runner } = sequenceRunner([published('sha512-dW5leHBlY3RlZA==')]);

    await expect(publishExactVersion(publishOptions, runner)).rejects.toThrow(
      /Published artifact integrity mismatch/,
    );
  });

  it('terminates a hung registry child at the command timeout', () => {
    const result = runCommand({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => undefined, 10_000)'],
      timeoutMs: 20,
    });

    expect(result.exitCode).toBeNull();
    expect(result.stderr).toMatch(/ETIMEDOUT|timed out/i);
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
    const promotionJob = workflow.match(
      / {2}promote-n8n-nodes-moltnet:[\s\S]*?(?=\n {2}publish-node-red:)/,
    )?.[0];
    expect(promotionJob).toContain('--repo "${{ github.repository }}"');
    expect(workflow).toMatch(
      /publish-n8n-nodes-moltnet:[\s\S]*timeout-minutes: 45/,
    );
  });
});
