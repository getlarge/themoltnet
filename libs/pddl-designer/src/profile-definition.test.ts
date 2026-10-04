/**
 * The committed runtime profile and policy are the reviewable source of truth
 * for the designer's agents. Keep them input-only and valid for the API.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RuntimeProfileContext,
  RuntimeProfileSandbox,
} from '@moltnet/runtime-profiles';
import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const json = (path: string) =>
  JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8')) as Record<
    string,
    unknown
  >;

const profile = json(
  '.github/runtime-profiles/legreffier-pddl-designer-v1.json',
);
const policy = json(
  '.github/runtime-policies/legreffier-pddl-designer-input-only-v1.json',
);

describe('legreffier-pddl-designer-v1 definitions', () => {
  it('has API-valid context entries and sandbox', () => {
    // Arrange
    const context = profile.context as unknown[];

    // Assert
    expect(
      context.map((entry) => Value.Check(RuntimeProfileContext, entry)),
    ).toEqual(context.map(() => true));
    expect(Value.Check(RuntimeProfileSandbox, profile.sandbox)).toBe(true);
  });

  it('is input-only: no workspace, no network, enforced empty tool policy', () => {
    expect(profile.allowedWorkspaceModes).toEqual(['none']);
    expect(profile.toolEnforcement).toBe('enforce');
    expect(
      (profile.sandbox as { network: { allowedHosts: string[] } }).network
        .allowedHosts,
    ).toEqual([]);
    expect(policy.tools).toEqual([]);
    expect(policy.shellCommands).toEqual([]);
  });
});
