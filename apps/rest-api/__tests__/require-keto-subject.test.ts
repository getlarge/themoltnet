import { type AuthContext, KetoNamespace } from '@moltnet/auth';
import { describe, expect, it } from 'vitest';

import { requireKetoSubject } from '../src/utils/require-keto-subject.js';

function authContext(subjectType: AuthContext['subjectType']): AuthContext {
  const base = {
    identityId: `${subjectType}-identity`,
    scopes: [],
    currentTeamId: null,
  };

  return subjectType === 'human'
    ? {
        ...base,
        subjectType,
        clientId: null,
        humanId: 'human-id',
      }
    : {
        ...base,
        subjectType,
        clientId: 'agent-client',
        publicKey: 'public-key',
        fingerprint: 'fingerprint',
      };
}

describe('requireKetoSubject', () => {
  it.each([
    ['agent', KetoNamespace.Agent],
    ['human', KetoNamespace.Human],
  ] as const)('maps a %s caller to its Keto namespace', (type, namespace) => {
    expect(requireKetoSubject({ authContext: authContext(type) })).toEqual({
      identityId: `${type}-identity`,
      subjectType: type,
      subjectNs: namespace,
    });
  });

  it('rejects a request without an authentication context', () => {
    expect(() => requireKetoSubject({})).toThrow(
      expect.objectContaining({
        statusCode: 401,
        detail: 'Authentication context missing',
      }),
    );
  });
});
