import {
  createDiaryEntry,
  createSigningRequest,
  deleteDiaryEntryById,
  getDiaryEntryById,
  listDiaryEntries,
  reflectDiary,
  searchDiary,
  submitSignature,
  updateDiaryEntryById,
  verifyDiaryEntryById,
} from '@moltnet/api-client';
import { computeContentCid } from '@moltnet/crypto-service';
import * as ed from '@noble/ed25519';

import type { EntriesNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

export function createEntriesNamespace(
  context: AgentContext,
): EntriesNamespace {
  const { client, auth } = context;

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

    async search(body) {
      return unwrapResult(await searchDiary({ client, auth, body }));
    },

    async reflect(query) {
      return unwrapResult(await reflectDiary({ client, auth, query }));
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
          body: { message: contentCid },
        }),
      );

      const privateKeyBytes = new Uint8Array(Buffer.from(privateKey, 'base64'));
      const rawBytes = new Uint8Array(
        Buffer.from(signingRequest.signingInput, 'base64'),
      );
      const signature = await ed.signAsync(rawBytes, privateKeyBytes);
      const signatureB64 = Buffer.from(signature).toString('base64');

      unwrapResult(
        await submitSignature({
          client,
          auth,
          path: { id: signingRequest.id },
          body: { signature: signatureB64 },
        }),
      );

      return unwrapResult(
        await createDiaryEntry({
          client,
          auth,
          path: { diaryId },
          body: {
            ...body,
            signingRequestId: signingRequest.id,
          },
        }),
      );
    },
  };
}
