import { describe, expect, it } from 'vitest';

import { capabilityGrantNames, decideHostCapabilityCall } from './policy.js';

describe('decideHostCapabilityCall', () => {
  const call = { capability: 'agent-signing', operation: 'sign-git-commit' };

  it('fails closed without a policy', () => {
    expect(decideHostCapabilityCall(call)).toMatchObject({
      allow: false,
      reasonCode: 'policy_not_ready',
    });
  });

  it('allows everything when enforcement is off', () => {
    expect(
      decideHostCapabilityCall({
        ...call,
        policy: { enforcement: 'off', allowedTools: new Set() },
      }),
    ).toEqual({ allow: true, reasonCode: 'policy_off' });
  });

  it('allows on a broad grant and on a narrow grant', () => {
    expect(
      decideHostCapabilityCall({
        ...call,
        policy: {
          enforcement: 'enforce',
          allowedTools: new Set(['capability:agent-signing']),
        },
      }),
    ).toEqual({ allow: true, reasonCode: 'capability_allowed' });
    expect(
      decideHostCapabilityCall({
        ...call,
        policy: {
          enforcement: 'enforce',
          allowedTools: new Set(['capability:agent-signing:sign-git-commit']),
        },
      }),
    ).toEqual({ allow: true, reasonCode: 'operation_allowed' });
  });

  it('denies in enforce mode without a grant and names the missing grants', () => {
    const decision = decideHostCapabilityCall({
      ...call,
      policy: {
        enforcement: 'enforce',
        allowedTools: new Set(['capability:agent-signing:sign-diary-entry']),
      },
    });
    expect(decision).toMatchObject({
      allow: false,
      reasonCode: 'capability_not_permitted',
    });
    expect((decision as { reason: string }).reason).toContain(
      'capability:agent-signing:sign-git-commit',
    );
  });

  it('exposes grant names', () => {
    expect(capabilityGrantNames('a', 'b')).toEqual([
      'capability:a',
      'capability:a:b',
    ]);
  });
});
