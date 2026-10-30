import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

import {
  type AuditAdvisory,
  devOnlyAdvisories,
  dropIgnores,
  hasPatchedVersion,
  overrideTarget,
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
  ): AuditAdvisory => ({
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

describe('workspace audit configuration', () => {
  it('exposes suppressed advisories without changing overrides or build permissions', () => {
    const workspace = parseDocument(`
# Keep the resolution policy intact.
overrides:
  lodash: ">=4.18.1"
auditConfig:
  ignoreGhsas:
    - GHSA-example
allowBuilds:
  esbuild: true
`);

    dropIgnores(workspace);

    expect(workspace.toJS()).toEqual({
      overrides: { lodash: '>=4.18.1' },
      auditConfig: {},
      allowBuilds: { esbuild: true },
    });
    expect(workspace.toString()).toContain(
      '# Keep the resolution policy intact.',
    );
  });

  it('accepts a workspace without audit suppressions', () => {
    const workspace = parseDocument('packages: ["apps/*"]\n');

    dropIgnores(workspace);

    expect(workspace.toJS()).toEqual({ packages: ['apps/*'] });
  });
});

describe('audit patched versions', () => {
  it.each([null, '<0.0.0', undefined])(
    'does not claim a fix for %s',
    (patched_versions) => {
      expect(hasPatchedVersion({ patched_versions })).toBe(false);
    },
  );

  it('recognizes an available patched release', () => {
    expect(hasPatchedVersion({ patched_versions: '>=1.2.3' })).toBe(true);
  });
});
