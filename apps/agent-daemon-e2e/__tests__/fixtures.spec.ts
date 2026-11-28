import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { loadCommittedRuntimeProfile } from '@moltnet/agent-eval';
import { describe, expect, it } from 'vitest';

import { createCommittedEvalProfile } from '../src/fixtures.js';

describe.each([
  'legreffier-adaptive-docs-review-v1',
  'legreffier-adaptive-focused-review-v1',
  'legreffier-adaptive-knowledge-review-v1',
  'legreffier-security-review-v2',
])('Committed profile fixture comparison: %s', (profileName) => {
  async function resolveWithRules(
    change: 'reorder' | 'assignment' | 'prefix' | 'omit' | 'extra',
  ) {
    const { profile, policies } = loadCommittedRuntimeProfile(
      join(import.meta.dirname, '../../..'),
      profileName,
      { nameSuffix: 'fixture' },
    );
    const rules = policies.flatMap((policy) => policy.shellCommands ?? []);
    const allowedShellCommands = rules.map((rule) =>
      Object.fromEntries(Object.entries(rule).reverse()),
    );
    allowedShellCommands.reverse();
    const restricted = allowedShellCommands.find(
      (rule) => rule.allowEnvironmentAssignments === false,
    );
    if (!restricted) throw new Error('Expected a committed restricted rule');
    if (change === 'assignment') restricted.allowEnvironmentAssignments = true;
    if (change === 'omit') delete restricted.allowEnvironmentAssignments;
    if (change === 'prefix') {
      restricted.argvPrefix = [
        ...(restricted.argvPrefix as string[]),
      ].reverse();
    }
    if (change === 'extra') restricted.unexpected = true;
    const agent = {
      runtimePolicies: {
        create: async () => ({ id: randomUUID() }),
        delete: async () => undefined,
      },
      runtimeProfiles: {
        create: async () => ({ id: randomUUID() }),
        setPolicies: async () => undefined,
        delete: async () => undefined,
        allowedTools: async () => ({
          enforcement: profile.toolEnforcement ?? 'off',
          allowedTools: policies.flatMap((policy) => policy.tools ?? []),
          allowedShellCommands,
        }),
      },
    } as unknown as Parameters<typeof createCommittedEvalProfile>[0]['agent'];
    return createCommittedEvalProfile({
      agent,
      teamId: 'fixture',
      profileName,
    });
  }

  it('ignores rule key order', async () => {
    const result = await resolveWithRules('reorder');
    await result.cleanup();
  });

  it.each(['assignment', 'prefix', 'omit', 'extra'] as const)(
    'still detects a changed rule: %s',
    async (change) => {
      await expect(resolveWithRules(change)).rejects.toThrow(
        'does not match the committed policies',
      );
    },
  );
});
