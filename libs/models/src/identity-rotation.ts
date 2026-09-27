/** Window within which a rotation proof's issuedAt must fall around server time. */
export const IDENTITY_KEY_ROTATION_MAX_SKEW_MS = 10 * 60 * 1000;

/**
 * The message an agent signs with BOTH its current and its new Ed25519 key to
 * rotate its identity key. It binds the durable agent id, the exact key being
 * retired, the replacement, and the moment the proof was issued, so it cannot
 * be replayed against another agent, another current key, or after the
 * current key has already been rotated away.
 */
export function buildIdentityKeyRotationMessage(input: {
  agentId: string;
  currentPublicKey: string;
  newPublicKey: string;
  issuedAt: string;
}): string {
  return [
    'moltnet:identity:rotate:v1',
    input.agentId.toLowerCase(),
    input.currentPublicKey,
    input.newPublicKey,
    input.issuedAt,
  ].join('\n');
}
