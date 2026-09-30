/**
 * `setup/` holds the definitions other repositories apply to run the review.
 * They are copies of the ones MoltNet reviews itself with, under neutral
 * names, so the security-relevant parts must never drift from those.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');

const json = (path: string) =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

/** What keeps a review agent read-only; provider and model may differ. */
const SECURITY_FIELDS = [
  'allowedWorkspaceModes',
  'context',
  'defaultWorkspaceMode',
  'maxBashTimeouts',
  'requiredEnv',
  'runtimeKind',
  'sandbox',
  'toolEnforcement',
] as const;

const pick = (value: Record<string, unknown>) =>
  Object.fromEntries(SECURITY_FIELDS.map((field) => [field, value[field]]));

const ownProfiles = readdirSync(resolve(repoRoot, '.github/runtime-profiles'))
  .filter((file) => file.startsWith('legreffier-docs-review-'))
  .map((file) => json(resolve(repoRoot, '.github/runtime-profiles', file)));

describe('setup definitions', () => {
  it('ship the same tool allow-list MoltNet enforces on its own reviews', () => {
    // Arrange
    const own = json(
      resolve(
        repoRoot,
        '.github/runtime-policies/legreffier-review-readonly-v1.json',
      ),
    );
    const shipped = json(
      resolve(packageRoot, 'setup/docs-review-readonly-policy.json'),
    );

    // Assert
    expect(shipped.name).toBe('docs-review-readonly-v1');
    expect(shipped.tools).toEqual(own.tools);
    expect(shipped.shellCommands).toEqual(own.shellCommands);
  });

  it('ship the sandbox, contract and enforcement of every own docs-review profile', () => {
    // Arrange
    const shipped = json(
      resolve(packageRoot, 'setup/docs-review-profile.json'),
    );

    // Assert
    expect(ownProfiles.length).toBeGreaterThan(0);
    expect(shipped.name).toBe('docs-review-v1');
    expect(shipped.toolEnforcement).toBe('enforce');
    for (const own of ownProfiles) {
      expect(pick(shipped)).toEqual(pick(own));
    }
  });
});
