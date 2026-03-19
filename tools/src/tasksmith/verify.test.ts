import { describe, expect, it } from 'vitest';

import {
  classifyTestCommand,
  isDockerDependent,
  outputIndicatesNoTestsRun,
  partitionCommands,
} from './verify.js';

describe('partitionCommands', () => {
  it('separates unit and docker commands', () => {
    const commands = [
      'pnpm --filter @moltnet/auth vitest run src/jwt.test.ts',
      'pnpm --filter @moltnet/rest-api test:e2e',
      'pnpm --filter @moltnet/database vitest run src/schema.test.ts',
    ];
    const { unit, docker } = partitionCommands(commands);
    expect(unit).toEqual([
      'pnpm --filter @moltnet/auth vitest run src/jwt.test.ts',
      'pnpm --filter @moltnet/database vitest run src/schema.test.ts',
    ]);
    expect(docker).toEqual(['pnpm --filter @moltnet/rest-api test:e2e']);
  });

  it('returns all as unit when no docker commands', () => {
    const { unit, docker } = partitionCommands(['pnpm test']);
    expect(unit).toEqual(['pnpm test']);
    expect(docker).toEqual([]);
  });
});

describe('classifyTestCommand', () => {
  it('classifies e2e tests as docker-dependent', () => {
    expect(isDockerDependent('pnpm --filter @moltnet/rest-api test:e2e')).toBe(
      true,
    );
  });

  it('classifies unit tests as non-docker', () => {
    expect(
      isDockerDependent(
        'pnpm --filter @moltnet/auth vitest run src/jwt.test.ts',
      ),
    ).toBe(false);
  });

  it('returns correct timeout for unit tests', () => {
    expect(
      classifyTestCommand(
        'pnpm --filter @moltnet/auth vitest run src/jwt.test.ts',
      ),
    ).toEqual({ isE2e: false, timeoutMs: 120_000 });
  });

  it('returns correct timeout for e2e tests', () => {
    expect(
      classifyTestCommand('pnpm --filter @moltnet/rest-api test:e2e'),
    ).toEqual({ isE2e: true, timeoutMs: 300_000 });
  });
});

describe('outputIndicatesNoTestsRun', () => {
  it('flags vitest no-test-files output', () => {
    expect(
      outputIndicatesNoTestsRun('No test files found, exiting with code 0'),
    ).toBe(true);
  });

  it('flags go no-tests-to-run output', () => {
    expect(
      outputIndicatesNoTestsRun(
        'ok github.com/getlarge/themoltnet/cmd/moltnet 0.1s [no tests to run]',
      ),
    ).toBe(true);
  });

  it('flags skipped-only vitest output', () => {
    expect(
      outputIndicatesNoTestsRun(
        'Test Files  1 skipped (1)\n      Tests  28 skipped (28)',
      ),
    ).toBe(true);
  });

  it('does not flag a normal passing run', () => {
    expect(
      outputIndicatesNoTestsRun(
        'Test Files  1 passed (1)\n      Tests  12 passed (12)',
      ),
    ).toBe(false);
  });
});
