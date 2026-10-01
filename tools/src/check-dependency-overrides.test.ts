import { describe, expect, it } from 'vitest';

import {
  devOnlyAdvisories,
  overrideTarget,
  // @ts-expect-error — plain .mjs tool script, no type declarations.
} from '../check-dependency-overrides.mjs';

/**
 * Override keys are the one place this check can silently do the wrong thing:
 * misparse a key and its package looks advisory-free, so a load-bearing pin
 * gets reported as dead. Scoped names are the trap — the leading `@` is not a
 * version separator.
 */
describe('overrideTarget', () => {
  it.each([
    ['lodash', 'lodash'],
    ['ajv@8', 'ajv'],
    ['undici@>=7.29.0 <8', 'undici'],
    ['@hono/node-server', '@hono/node-server'],
    ['@opentelemetry/core@2', '@opentelemetry/core'],
    ['@isaacs/brace-expansion', '@isaacs/brace-expansion'],
  ])('reads %s as %s', (key, expected) => {
    expect(overrideTarget(key)).toBe(expected);
  });

  // pnpm scopes an override to a parent with `>`; the entry still targets the
  // last segment.
  it.each([
    ['parent>lodash', 'lodash'],
    ['parent@1>@scope/pkg@2', '@scope/pkg'],
    ['a>b>c', 'c'],
  ])('reads the target of %s as %s', (key, expected) => {
    expect(overrideTarget(key)).toBe(expected);
  });

  it('tolerates surrounding whitespace', () => {
    expect(overrideTarget('parent> lodash ')).toBe('lodash');
  });
});

/**
 * A dead override can still have been holding back a tooling advisory. The
 * verdict ignores those on purpose; the report must not hide them.
 */
describe('devOnlyAdvisories', () => {
  const advisory = (
    id: string,
    module_name: string,
    severity = 'high',
  ): Record<string, unknown> => ({
    github_advisory_id: id,
    module_name,
    severity,
    title: `${module_name} advisory`,
  });

  it('returns advisories on the target that only the full audit reports', () => {
    // Arrange
    const prod = { advisories: {} };
    const full = {
      advisories: {
        1: advisory('GHSA-bbbb', 'adm-zip', 'high'),
        2: advisory('GHSA-aaaa', 'adm-zip', 'moderate'),
        3: advisory('GHSA-cccc', 'other'),
      },
    };

    // Act
    const result = devOnlyAdvisories('adm-zip', prod, full);

    // Assert
    expect(result).toEqual([
      { id: 'GHSA-aaaa', severity: 'moderate', title: 'adm-zip advisory' },
      { id: 'GHSA-bbbb', severity: 'high', title: 'adm-zip advisory' },
    ]);
  });

  it('excludes advisories the production audit also reports', () => {
    // Arrange
    const shared = advisory('GHSA-prod', 'undici');
    const prod = { advisories: { 1: shared } };
    const full = {
      advisories: { 1: shared, 2: advisory('GHSA-dev', 'undici') },
    };

    // Act
    const result = devOnlyAdvisories('undici', prod, full);

    // Assert
    expect(result.map((a: { id: string }) => a.id)).toEqual(['GHSA-dev']);
  });

  it('returns nothing when either report has no advisories', () => {
    // Arrange
    const empty = {};

    // Act
    const result = devOnlyAdvisories('lodash', empty, empty);

    // Assert
    expect(result).toEqual([]);
  });
});
