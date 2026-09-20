import { describe, expect, it } from 'vitest';

import { cryptoService } from './crypto.service.js';
import { enrollmentProofMessage } from './enrollment-proof.js';

const grant = {
  agentId: 'agent',
  teamId: 'team',
  operation: 'enroll' as const,
  scopes: ['task:read', 'task:execute'],
  idempotencyKey: 'request',
};
describe('PKCE enrollment identity proof', () => {
  it('binds the identity signature to the approved target and token', async () => {
    const owner = await cryptoService.generateKeyPair();
    const other = await cryptoService.generateKeyPair();
    const message = enrollmentProofMessage({
      accessToken: 'approval-token',
      grant,
    });
    const signature = await cryptoService.sign(message, owner.privateKey);
    expect(
      await cryptoService.verify(message, signature, owner.publicKey),
    ).toBe(true);
    expect(
      await cryptoService.verify(message, signature, other.publicKey),
    ).toBe(false);
    for (const changed of [
      { agentId: 'other' },
      { teamId: 'other' },
      { operation: 'renew' as const },
      { scopes: ['task:read'] },
      { idempotencyKey: 'other' },
    ]) {
      expect(
        await cryptoService.verify(
          enrollmentProofMessage({
            accessToken: 'approval-token',
            grant: { ...grant, ...changed },
          }),
          signature,
          owner.publicKey,
        ),
      ).toBe(false);
    }
    expect(
      await cryptoService.verify(
        enrollmentProofMessage({ accessToken: 'another-approval', grant }),
        signature,
        owner.publicKey,
      ),
    ).toBe(false);
    expect(message).not.toContain('approval-token');
  });
});
