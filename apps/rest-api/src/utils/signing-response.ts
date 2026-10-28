import { buildSigningBytes } from '@moltnet/crypto-service';
import type { PrincipalIdentity, SigningRequest } from '@moltnet/database';

import { batchInflateRowsWithCreator } from './auth-principal.js';

/**
 * Shape signing requests for the API, resolving every requester with one
 * agents and one humans lookup.
 */
export async function shapeSigningRequests(
  rows: readonly SigningRequest[],
  deps: Parameters<typeof batchInflateRowsWithCreator>[1],
) {
  const inflated = await batchInflateRowsWithCreator(
    rows.map((row) => ({
      row,
      creatorAgentId: row.requesterAgentId,
      creatorHumanId: row.requesterHumanId,
    })),
    deps,
  );
  return inflated.map(({ row, creator }) => toSigningResponse(row, creator));
}

export async function shapeSigningRequest(
  row: SigningRequest,
  deps: Parameters<typeof batchInflateRowsWithCreator>[1],
) {
  const [response] = await shapeSigningRequests([row], deps);
  return response;
}

function toSigningResponse(
  row: SigningRequest,
  requestedBy: PrincipalIdentity,
) {
  return {
    id: row.id,
    verificationMethod: row.verificationMethod,
    requestedBy,
    signerConstraint: row.signerConstraint ?? null,
    teamId: row.teamId ?? null,
    purpose: row.purpose ?? null,
    claimedByHumanId: row.claimedByHumanId ?? null,
    signingCredentialId: row.signingCredentialId ?? null,
    challenge: row.challenge ?? null,
    receipt: row.receipt ?? null,
    message: row.message,
    nonce: row.nonce,
    signingInput: Buffer.from(
      buildSigningBytes(row.message, row.nonce),
    ).toString('base64'),
    status: row.status,
    signature: row.signature,
    valid: row.valid,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    completedAt: row.completedAt,
    claimedAt: row.claimedAt ?? null,
    rejectedAt: row.rejectedAt ?? null,
    rejectionReason: row.rejectionReason ?? null,
  };
}
