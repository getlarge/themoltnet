import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AGENT_ALIAS_PATTERN } from '@moltnet/models';
import { describe, expect, it } from 'vitest';

import { IDENTITY_ALIAS_PATTERN } from '../src/config.js';

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

describe('identity alias grammar', () => {
  it('is the same pattern the REST alias schema validates against', () => {
    expect(IDENTITY_ALIAS_PATTERN.source).toBe(AGENT_ALIAS_PATTERN);
  });

  it('matches the Go CLI agentNamePattern literally', () => {
    // The CLI validates `agents init --name` and `register --name` locally and
    // then publishes that name as the network alias. A drift here makes a
    // locally accepted name fail server validation with a 400.
    const source = readFileSync(
      join(repoRoot, 'apps', 'moltnet-cli', 'agents_init.go'),
      'utf8',
    );
    const match = source.match(
      /var agentNamePattern = regexp\.MustCompile\(`([^`]+)`\)/,
    );

    expect(match?.[1]).toBe(AGENT_ALIAS_PATTERN);
  });

  it.each([
    ['Build.Agent', true],
    ['a'.repeat(63), true],
    ['a'.repeat(64), false],
    ['-leading-dash', false],
    ['has space', false],
    ['', false],
    ['ünïcode', false],
  ])('classifies %j as valid=%s', (alias, valid) => {
    expect(IDENTITY_ALIAS_PATTERN.test(alias)).toBe(valid);
  });
});
