import { DBOS } from '@dbos-inc/dbos-sdk';

export interface VerificationPayload {
  sourceEntries: Array<{
    title: string;
    content: string;
    contentHash: string;
  }>;
  renderedContent: string;
  rubric: string;
}

export interface VerificationSubmission {
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

export interface VerificationResult {
  verificationId: string;
  status: 'submitted' | 'expired' | 'invalid';
  attestationId?: string;
  composite?: number;
}

export interface VerificationWorkflowDeps {
  updateVerificationStatus(
    verificationId: string,
    status: 'claimed' | 'submitted' | 'expired',
    claimedBy?: string,
  ): Promise<void>;
  loadRenderedPack(renderedPackId: string): Promise<{
    id: string;
    sourcePackId: string;
    content: string;
  } | null>;
  listSourceEntries(sourcePackId: string): Promise<
    Array<{
      entryCidSnapshot: string;
      entry: { title: string | null; content: string };
    }>
  >;
  createAttestation(input: {
    renderedPackId: string;
    coverage: number;
    grounding: number;
    faithfulness: number;
    composite: number;
    judgeModel: string;
    judgeProvider: string;
    judgeBinaryCid: string;
    rubricCid: string | null;
    createdBy: string;
    transcript: string;
  }): Promise<{ id: string }>;
}

export class VerificationWorkflowConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerificationWorkflowConfigurationError';
  }
}

const DEFAULT_RUBRIC = `Evaluate the rendered content against the source entries on three axes:

COVERAGE (0.0-1.0):
- Identify each distinct topic/fact in the source entries
- Check if each is represented in the rendered content
- Score = (represented topics) / (total source topics)

GROUNDING (0.0-1.0):
- Identify each distinct claim/fact in the rendered content
- Check if each is traceable to a specific source entry
- Score = (grounded claims) / (total rendered claims)

FAITHFULNESS (0.0-1.0):
- For content that IS represented, check semantic accuracy
- Is the meaning preserved? Any distortions, inversions, or misquotes?
- Score = (accurate representations) / (total representations)`;

const VERIFICATION_TIMEOUT_SECONDS = 600;
const stepConfig = {
  retriesAllowed: true,
  maxAttempts: 3,
  intervalSeconds: 2,
  backoffRate: 2,
};

let workflowDeps: VerificationWorkflowDeps | null = null;
let _workflows: {
  startVerification: (
    verificationId: string,
    renderedPackId: string,
    nonce: string,
  ) => Promise<{ verificationId: string; nonce: string }>;
} | null = null;

function getDeps(): VerificationWorkflowDeps {
  if (!workflowDeps) {
    throw new VerificationWorkflowConfigurationError(
      'Verification workflow deps not set. Call setVerificationWorkflowDeps() before using verification workflows.',
    );
  }

  return workflowDeps;
}

export function setVerificationWorkflowDeps(
  deps: VerificationWorkflowDeps,
): void {
  workflowDeps = deps;
}

export function initVerificationWorkflows(): void {
  if (_workflows) return;

  const buildPayloadStep = DBOS.registerStep(
    async (renderedPackId: string): Promise<VerificationPayload> => {
      const renderedPack = await getDeps().loadRenderedPack(renderedPackId);
      if (!renderedPack) {
        throw new VerificationWorkflowConfigurationError(
          `Rendered pack ${renderedPackId} not found for verification workflow`,
        );
      }

      const entries = await getDeps().listSourceEntries(
        renderedPack.sourcePackId,
      );

      return {
        sourceEntries: entries.map((row) => ({
          title: row.entry.title ?? 'Untitled',
          content: row.entry.content,
          contentHash: row.entryCidSnapshot,
        })),
        renderedContent: renderedPack.content,
        rubric: DEFAULT_RUBRIC,
      };
    },
    { name: 'verification.step.buildPayload', ...stepConfig },
  );

  const createAttestationStep = DBOS.registerStep(
    async (
      renderedPackId: string,
      submission: VerificationSubmission,
    ): Promise<{ id: string; composite: number }> => {
      const composite = Math.min(
        submission.coverage,
        submission.grounding,
        submission.faithfulness,
      );
      const attestation = await getDeps().createAttestation({
        renderedPackId,
        coverage: submission.coverage,
        grounding: submission.grounding,
        faithfulness: submission.faithfulness,
        composite,
        judgeModel: submission.judgeModel,
        judgeProvider: submission.judgeProvider,
        judgeBinaryCid: submission.judgeBinaryCid,
        rubricCid: null,
        createdBy: submission.createdBy,
        transcript: submission.transcript,
      });

      return { id: attestation.id, composite };
    },
    { name: 'verification.step.createAttestation', ...stepConfig },
  );

  const updateVerificationStatusStep = DBOS.registerStep(
    async (
      verificationId: string,
      status: 'claimed' | 'submitted' | 'expired',
      claimedBy?: string,
    ): Promise<void> => {
      await getDeps().updateVerificationStatus(
        verificationId,
        status,
        claimedBy,
      );
    },
    { name: 'verification.step.updateStatus', ...stepConfig },
  );

  _workflows = {
    startVerification: DBOS.registerWorkflow(
      async (
        verificationId: string,
        renderedPackId: string,
        nonce: string,
      ): Promise<{ verificationId: string; nonce: string }> => {
        await DBOS.setEvent('created', { verificationId, nonce });

        const claim = await DBOS.recv<{ judgeIdentityId: string }>(
          'claim',
          VERIFICATION_TIMEOUT_SECONDS,
        );
        if (!claim) {
          await updateVerificationStatusStep(verificationId, 'expired');
          const result: VerificationResult = {
            verificationId,
            status: 'expired',
          };
          await DBOS.setEvent('result', result);
          return { verificationId, nonce };
        }

        await updateVerificationStatusStep(
          verificationId,
          'claimed',
          claim.judgeIdentityId,
        );

        const payload = await buildPayloadStep(renderedPackId);
        await DBOS.setEvent(`payload:${claim.judgeIdentityId}`, payload);

        const submission = await DBOS.recv<VerificationSubmission>(
          'submit',
          VERIFICATION_TIMEOUT_SECONDS,
        );
        if (!submission) {
          await updateVerificationStatusStep(verificationId, 'expired');
          const result: VerificationResult = {
            verificationId,
            status: 'expired',
          };
          await DBOS.setEvent('result', result);
          return { verificationId, nonce };
        }

        if (
          submission.nonce !== nonce ||
          submission.createdBy !== claim.judgeIdentityId
        ) {
          await updateVerificationStatusStep(verificationId, 'expired');
          const result: VerificationResult = {
            verificationId,
            status: 'invalid',
          };
          await DBOS.setEvent('result', result);
          return { verificationId, nonce };
        }

        const attestation = await createAttestationStep(
          renderedPackId,
          submission,
        );
        await updateVerificationStatusStep(verificationId, 'submitted');
        const result: VerificationResult = {
          verificationId,
          status: 'submitted',
          attestationId: attestation.id,
          composite: attestation.composite,
        };
        await DBOS.setEvent('result', result);
        return { verificationId, nonce };
      },
      { name: 'verification.workflow.startVerification' },
    ),
  };
}

export const verificationWorkflows = new Proxy(
  {},
  {
    get(_, prop) {
      if (!_workflows) {
        throw new VerificationWorkflowConfigurationError(
          'Verification workflows not initialized. Call initVerificationWorkflows() first.',
        );
      }

      return _workflows[prop as keyof typeof _workflows];
    },
  },
) as {
  startVerification: (
    verificationId: string,
    renderedPackId: string,
    nonce: string,
  ) => Promise<{ verificationId: string; nonce: string }>;
};

/** @internal Reset module state for testing. */
export function _resetVerificationWorkflowsForTesting(): void {
  _workflows = null;
  workflowDeps = null;
}
