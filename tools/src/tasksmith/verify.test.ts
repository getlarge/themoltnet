import { describe, expect, it } from 'vitest';

import {
  classifyTestCommand,
  isDockerDependent,
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
