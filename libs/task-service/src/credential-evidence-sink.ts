import type { CredentialEvidenceRepository } from '@moltnet/database';
import type { EvidenceSink } from '@themoltnet/credential-broker';
import {
  type CredentialEvidenceEvent,
  isCredentialEvidenceEvent,
} from '@themoltnet/credentials';

import type { Logger } from './task-service.types.js';

export interface CredentialEvidenceSinkDeps {
  repository: Pick<CredentialEvidenceRepository, 'append'>;
  logger: Pick<Logger, 'error'>;
}

/**
 * Durable {@link EvidenceSink} backed by the append-only
 * `credential_evidence_events` table.
 *
 * The two write semantics live in the broker, not here: it awaits this sink and
 * fails issuance closed (`evidence_unavailable`) when an issuance event cannot
 * be persisted, while a denial-event failure is swallowed so it can never mask
 * the typed denial. This sink therefore always propagates failures — and logs
 * them, because for denials that log is the only signal a write was lost.
 */
export function createCredentialEvidenceSink(
  deps: CredentialEvidenceSinkDeps,
): EvidenceSink {
  return {
    async emit(event: CredentialEvidenceEvent): Promise<void> {
      // The contract is closed and secret-free. Re-check it at the boundary so
      // a malformed event fails loudly rather than persisting an unqueryable
      // row (or a field the audit trail is not supposed to carry).
      if (!isCredentialEvidenceEvent(event)) {
        deps.logger.error(
          { event: (event as { event?: unknown })?.event },
          'credential.evidence_event_invalid',
        );
        throw new Error(
          'Credential evidence event does not match the contract',
        );
      }
      const occurredAt = new Date(event.occurredAt);
      if (Number.isNaN(occurredAt.getTime())) {
        deps.logger.error(
          { event: event.event },
          'credential.evidence_event_invalid',
        );
        throw new Error('Credential evidence event has an invalid timestamp');
      }
      try {
        await deps.repository.append({
          version: event.version,
          event: event.event,
          occurredAt,
          outcome: event.outcome,
          reason: event.reason,
          agentId: event.agentId ?? null,
          teamId: event.teamId ?? null,
          taskId: event.taskId ?? null,
          attemptN: event.attemptN ?? null,
          connectorId: event.connectorId ?? null,
          operation: event.operation ?? null,
          resourceId: event.resourceId ?? null,
          grantId: event.grantId ?? null,
          grantRevision: event.grantRevision ?? null,
          credentialJti: event.credentialJti ?? null,
          credentialKid: event.credentialKid ?? null,
        });
      } catch (err) {
        deps.logger.error(
          {
            err,
            event: event.event,
            outcome: event.outcome,
            reason: event.reason,
            taskId: event.taskId,
            attemptN: event.attemptN,
          },
          'credential.evidence_persist_failed',
        );
        throw err;
      }
    },
  };
}
