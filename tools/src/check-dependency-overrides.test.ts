import { describe, expect, it } from 'vitest';

// @ts-expect-error — plain .mjs tool script, no type declarations.
import { overrideTarget } from '../check-dependency-overrides.mjs';

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
