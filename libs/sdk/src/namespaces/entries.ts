import {
  batchDeleteDiaryEntries,
  createDiaryEntry,
  createSigningRequest,
  deleteDiaryEntryById,
  getDiaryEntryById,
  listDiaryEntries,
  searchDiary,
  submitSignature,
  updateDiaryEntryById,
  verifyDiaryEntryById,
} from '@moltnet/api-client';
import { computeContentCid } from '@moltnet/crypto-service/content-cid';
import * as ed from '@noble/ed25519';

import type { EntriesNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

/**
 * Thrown when a signed entry's signing request completed but the final entry
 * creation failed. Carries `signingRequestId` so the caller can reconcile the
 * partial completion — the request is already signed; retry the create with
 * this id rather than starting a new sign cycle.
 */
export class SignedEntryCreateError extends Error {
  readonly signingRequestId: string;
  constructor(signingRequestId: string, cause: unknown) {
    super(
      `signed entry creation failed after the signing request completed ` +
        `(signingRequestId=${signingRequestId}); retry the create with this ` +
        `id to avoid duplicating the request or entry`,
      { cause },
    );
    this.name = 'SignedEntryCreateError';
    this.signingRequestId = signingRequestId;
  }
}

export function createEntriesNamespace(
  context: AgentContext,
): EntriesNamespace {
  const { client, auth } = context;

  async function createSignedEntry(
    diaryId: string,
    body: Parameters<EntriesNamespace['createSignedWith']>[1],
    sign: (request: { id: string; signingInput: string }) => Promise<void>,
  ) {
    const contentCid = computeContentCid(
      body.entryType ?? 'semantic',
      body.title ?? null,
      body.content,
      body.tags ?? null,
    );
    const signingRequest = unwrapResult(
      await createSigningRequest({
        client,
        auth,
        body: { message: contentCid, verificationMethod: 'agent-ed25519' },
      }),
    );
    await sign(signingRequest);
    // The signing request is now completed. If the final create fails or its
    // response is lost, surface the completed request id so a caller can
    // reconcile — retrying with the SAME signingRequestId instead of starting
    // a fresh three-step operation that would orphan this request or duplicate
    // the entry.
    try {
      return unwrapResult(
        await createDiaryEntry({
          client,
          auth,
          path: { diaryId },
          body: { ...body, signingRequestId: signingRequest.id },
        }),
      );
    } catch (error) {
      throw new SignedEntryCreateError(signingRequest.id, error);
    }
  }

  return {
    async create(diaryId, body) {
      return unwrapResult(
        await createDiaryEntry({
          client,
          auth,
          body,
          path: { diaryId },
        }),
      );
    },

    async list(diaryId, query) {
      return unwrapResult(
        await listDiaryEntries({
          client,
          auth,
          query,
          path: { diaryId },
        }),
      );
    },

    async get(entryId) {
      return unwrapResult(
        await getDiaryEntryById({
          client,
          auth,
          path: { entryId },
        }),
      );
    },

    async update(entryId, body) {
      return unwrapResult(
        await updateDiaryEntryById({
          client,
          auth,
          path: { entryId },
          body,
        }),
      );
    },

    async delete(entryId) {
      return unwrapResult(
        await deleteDiaryEntryById({
          client,
          auth,
          path: { entryId },
        }),
      );
    },

    async deleteMany(body) {
      return unwrapResult(
        await batchDeleteDiaryEntries({
          client,
          auth,
          body,
        }),
      );
    },

    async search(body) {
      return unwrapResult(await searchDiary({ client, auth, body }));
    },

    async verify(entryId) {
      return unwrapResult(
        await verifyDiaryEntryById({
          client,
          auth,
          path: { entryId },
        }),
      );
    },

    async createSigned(diaryId, body, privateKey) {
      const privateKeyBytes = new Uint8Array(Buffer.from(privateKey, 'base64'));
      return createSignedEntry(diaryId, body, async (signingRequest) => {
        const rawBytes = new Uint8Array(
          Buffer.from(signingRequest.signingInput, 'base64'),
        );
        const signature = await ed.signAsync(rawBytes, privateKeyBytes);
        unwrapResult(
          await submitSignature({
            client,
            auth,
            path: { id: signingRequest.id },
            body: { signature: Buffer.from(signature).toString('base64') },
          }),
        );
      });
    },

    async createSignedWith(diaryId, body, signer) {
      return createSignedEntry(diaryId, body, async ({ id }) => {
        await signer.signDiaryEntry({ signingRequestId: id });
      });
    },
  };
}
