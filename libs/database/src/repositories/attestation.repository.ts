import { desc, eq } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type NewRenderedPackAttestation,
  type RenderedPackAttestation,
  renderedPackAttestations,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export function createAttestationRepository(db: Database) {
  return {
    async create(
      input: NewRenderedPackAttestation,
    ): Promise<RenderedPackAttestation> {
      const [row] = await getExecutor(db)
        .insert(renderedPackAttestations)
        .values(input)
        .returning();
      return row;
    },

    async findByRenderedPackId(
      renderedPackId: string,
    ): Promise<RenderedPackAttestation[]> {
      return getExecutor(db)
        .select()
        .from(renderedPackAttestations)
        .where(eq(renderedPackAttestations.renderedPackId, renderedPackId))
        .orderBy(desc(renderedPackAttestations.composite));
    },

    async findBestByRenderedPackId(
      renderedPackId: string,
    ): Promise<RenderedPackAttestation | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(renderedPackAttestations)
        .where(eq(renderedPackAttestations.renderedPackId, renderedPackId))
        .orderBy(desc(renderedPackAttestations.composite))
        .limit(1);
      return row ?? null;
    },
  };
}

export type AttestationRepository = ReturnType<
  typeof createAttestationRepository
>;
