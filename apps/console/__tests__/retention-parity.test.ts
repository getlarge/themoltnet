/**
 * Guards the console/API retention coupling.
 *
 * `defaultUnpinExpiry` computes the unpin deadline from `packGcTtlDays`, which
 * nginx injects from `PACK_GC_COMPILE_TTL_DAYS`. The API applies its own copy
 * of that variable when it creates a pack. If the two deployments are given
 * different values, a pin→unpin cycle silently rewrites the operator's
 * retention policy — the exact bug this is meant to prevent.
 *
 * `env.public` is the committed source of truth for non-secret config, so this
 * asserts the console's fly.toml agrees with it.
 *
 * LIMIT: this only covers the values committed to the repo. A runtime override
 * (`fly secrets set`, a changed machine env) on one service and not the other
 * is still undetectable from here. #1858 removes the coupling entirely by
 * having the API assign the deadline itself.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const VAR = 'PACK_GC_COMPILE_TTL_DAYS';

function readValue(relativePath: string): string | undefined {
  const contents = readFileSync(join(REPO_ROOT, relativePath), 'utf8');
  // Matches both `KEY="7"` (env.public) and `KEY = "7"` (fly.toml).
  const match = new RegExp(`^\\s*${VAR}\\s*=\\s*"?([^"\\n]+)"?`, 'm').exec(
    contents,
  );
  return match?.[1]?.trim();
}

describe(`${VAR} deployment parity`, () => {
  it('is declared in env.public', () => {
    expect(readValue('env.public')).toBeDefined();
  });

  it('matches between env.public and the console deployment', () => {
    const shared = readValue('env.public');
    const console = readValue('apps/console/fly.toml');

    expect(console).toBeDefined();
    expect(console).toBe(shared);
  });

  it('is a value the console config parser accepts', () => {
    const raw = readValue('env.public');
    const parsed = Number(raw);

    expect(Number.isFinite(parsed)).toBe(true);
    expect(parsed).toBeGreaterThan(0);
  });
});
