/**
 * Credential Evidence Repository
 *
 * Append-only audit trail for credential-ladder decisions. Writes only ever
 * insert; the retention prune is the single deleting operation. See
 * `../schema/credential-evidence-events.ts` for why the table carries no
 * foreign keys and no token column.
 */

import { and, asc, eq, lt } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type CredentialEvidenceEventRecord,
  credentialEvidenceEvents,
  type NewCredentialEvidenceEventRecord,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export type AppendCredentialEvidenceInput = Omit<
  NewCredentialEvidenceEventRecord,
  'id' | 'recordedAt'
>;

export function createCredentialEvidenceRepository(db: Database) {
  return {
    /**
     * Persist one evidence event. Callers decide whether a failure is fatal:
     * issuance evidence must propagate it, denial evidence must swallow it.
     */
    async append(
      input: AppendCredentialEvidenceInput,
    ): Promise<CredentialEvidenceEventRecord> {
      const [created] = await getExecutor(db)
        .insert(credentialEvidenceEvents)
        .values(input)
        .returning();
      if (!created) {
        throw new Error('Credential evidence event was not persisted');
      }
      return created;
    },

    /** Audit read: every decision recorded for one task attempt, oldest first. */
    async listByAttempt(
      taskId: string,
      attemptN: number,
    ): Promise<CredentialEvidenceEventRecord[]> {
      return getExecutor(db)
        .select()
        .from(credentialEvidenceEvents)
        .where(
          and(
            eq(credentialEvidenceEvents.taskId, taskId),
            eq(credentialEvidenceEvents.attemptN, attemptN),
          ),
        )
        .orderBy(asc(credentialEvidenceEvents.occurredAt));
    },

    /**
     * Retention prune. Evidence outlives the tasks it describes, so it is aged
     * out on its own clock rather than with task retention.
     */
    async pruneOlderThan(cutoff: Date): Promise<number> {
      const pruned = await getExecutor(db)
        .delete(credentialEvidenceEvents)
        .where(lt(credentialEvidenceEvents.occurredAt, cutoff))
        .returning({ id: credentialEvidenceEvents.id });
      return pruned.length;
    },
  };
}

export type CredentialEvidenceRepository = ReturnType<
  typeof createCredentialEvidenceRepository
>;
