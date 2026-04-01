import {
  DBOS,
  type VerificationPayload,
  type VerificationResult,
  verificationWorkflows,
} from '@moltnet/database';

export class VerificationServiceError extends Error {
  constructor(
    public readonly code:
      | 'not_found'
      | 'conflict'
      | 'expired'
      | 'invalid'
      | 'timed_out',
    message: string,
  ) {
    super(message);
    this.name = 'VerificationServiceError';
  }
}

export interface SubmitVerificationInput {
  nonce: string;
  coverage: number;
  grounding: number;
  faithfulness: number;
  transcript: string;
  judgeModel: string;
  judgeProvider: string;
  judgeBinaryCid: string;
  createdBy: string;
}

const EVENT_TIMEOUT_SECONDS = 5;

function workflowIdForRenderedPack(renderedPackId: string): string {
  return `verification-${renderedPackId}`;
}

async function getResultEvent(
  workflowID: string,
): Promise<VerificationResult | null> {
  return DBOS.getEvent<VerificationResult>(workflowID, 'result', 0);
}

export function createVerificationService() {
  return {
    async createVerification(
      renderedPackId: string,
      nonce: string,
    ): Promise<{ verificationId: string; nonce: string }> {
      const workflowID = workflowIdForRenderedPack(renderedPackId);

      try {
        await DBOS.startWorkflow(verificationWorkflows.startVerification, {
          workflowID,
        })(renderedPackId, nonce);
      } catch {
        // If the workflow already exists, read its existing events below.
      }

      const created = await DBOS.getEvent<{
        verificationId: string;
        nonce: string;
      }>(workflowID, 'created', EVENT_TIMEOUT_SECONDS);

      if (!created) {
        throw new VerificationServiceError(
          'conflict',
          'Verification workflow could not be initialized for this rendered pack',
        );
      }

      return created;
    },

    async claim(renderedPackId: string, judgeIdentityId: string) {
      const workflowID = workflowIdForRenderedPack(renderedPackId);

      try {
        await DBOS.send(workflowID, { judgeIdentityId }, 'claim');
      } catch {
        throw new VerificationServiceError(
          'not_found',
          'No active verification found for this rendered pack',
        );
      }

      const payload = await DBOS.getEvent<VerificationPayload>(
        workflowID,
        'payload',
        EVENT_TIMEOUT_SECONDS,
      );

      if (payload) {
        return payload;
      }

      const result = await getResultEvent(workflowID);
      if (result?.status === 'expired') {
        throw new VerificationServiceError(
          'expired',
          'Verification expired before the judge claimed the payload',
        );
      }
      if (result?.status === 'invalid') {
        throw new VerificationServiceError(
          'invalid',
          'Verification workflow rejected this claim',
        );
      }

      throw new VerificationServiceError(
        'timed_out',
        'Verification claim timed out waiting for the workflow payload',
      );
    },

    async submit(renderedPackId: string, input: SubmitVerificationInput) {
      const workflowID = workflowIdForRenderedPack(renderedPackId);

      try {
        await DBOS.send(workflowID, input, 'submit');
      } catch {
        throw new VerificationServiceError(
          'not_found',
          'No active verification found for this rendered pack',
        );
      }

      const result = await DBOS.getEvent<VerificationResult>(
        workflowID,
        'result',
        EVENT_TIMEOUT_SECONDS,
      );

      if (!result) {
        throw new VerificationServiceError(
          'timed_out',
          'Verification submit timed out waiting for the workflow result',
        );
      }
      if (result.status === 'expired') {
        throw new VerificationServiceError(
          'expired',
          'Verification expired before the judge submitted results',
        );
      }
      if (result.status === 'invalid') {
        throw new VerificationServiceError(
          'invalid',
          'Verification workflow rejected the submitted results',
        );
      }
      if (!result.attestationId || result.composite === undefined) {
        throw new VerificationServiceError(
          'conflict',
          'Verification workflow completed without an attestation result',
        );
      }

      return {
        attestationId: result.attestationId,
        composite: result.composite,
      };
    },
  };
}

export type VerificationService = ReturnType<typeof createVerificationService>;
