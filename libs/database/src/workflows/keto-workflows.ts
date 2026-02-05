/**
 * Keto Durable Workflows
 *
 * DBOS workflows for Ory Keto relationship operations. These ensure
 * Keto relationship changes are durable and retry on transient failures.
 *
 * Each workflow wraps a single Keto operation with:
 * - Automatic retry (5 attempts with exponential backoff)
 * - Crash recovery (resumes from last completed step)
 * - Idempotency (re-running completed workflows is a no-op)
 */

import { DBOS } from '@dbos-inc/dbos-sdk';

/**
 * Interface for Keto relationship write operations.
 * The full implementation lives in @moltnet/auth — we define a minimal
 * version here to avoid circular dependencies.
 */
export interface KetoRelationshipWriter {
  grantOwnership(entryId: string, agentId: string): Promise<void>;
  grantViewer(entryId: string, agentId: string): Promise<void>;
  revokeViewer(entryId: string, agentId: string): Promise<void>;
  registerAgent(agentId: string): Promise<void>;
  removeEntryRelations(entryId: string): Promise<void>;
}

// KetoRelationshipWriter is injected at runtime before DBOS.launch()
let relationshipWriter: KetoRelationshipWriter | null = null;

/**
 * Set the KetoRelationshipWriter instance for Keto workflows.
 * Must be called before DBOS.launch().
 */
export function setKetoRelationshipWriter(
  writer: KetoRelationshipWriter,
): void {
  relationshipWriter = writer;
}

function getRelationshipWriter(): KetoRelationshipWriter {
  if (!relationshipWriter) {
    throw new Error(
      'KetoRelationshipWriter not set. Call setKetoRelationshipWriter() before using Keto workflows.',
    );
  }
  return relationshipWriter;
}

// ── Retry Configuration ──────────────────────────────────────────────
// 5 attempts with exponential backoff: 2s, 4s, 8s, 16s, 32s
// Total max wait: 62 seconds before giving up

const ketoStepConfig = {
  retriesAllowed: true,
  maxAttempts: 5,
  intervalSeconds: 2,
  backoffRate: 2,
};

// ── Steps ────────────────────────────────────────────────────────────
// Each step wraps a single Keto API call

const grantOwnershipStep = DBOS.registerStep(
  async (entryId: string, agentId: string): Promise<void> => {
    await getRelationshipWriter().grantOwnership(entryId, agentId);
  },
  { name: 'keto.step.grantOwnership', ...ketoStepConfig },
);

const removeEntryRelationsStep = DBOS.registerStep(
  async (entryId: string): Promise<void> => {
    await getRelationshipWriter().removeEntryRelations(entryId);
  },
  { name: 'keto.step.removeEntryRelations', ...ketoStepConfig },
);

const grantViewerStep = DBOS.registerStep(
  async (entryId: string, agentId: string): Promise<void> => {
    await getRelationshipWriter().grantViewer(entryId, agentId);
  },
  { name: 'keto.step.grantViewer', ...ketoStepConfig },
);

const revokeViewerStep = DBOS.registerStep(
  async (entryId: string, agentId: string): Promise<void> => {
    await getRelationshipWriter().revokeViewer(entryId, agentId);
  },
  { name: 'keto.step.revokeViewer', ...ketoStepConfig },
);

const registerAgentStep = DBOS.registerStep(
  async (agentId: string): Promise<void> => {
    await getRelationshipWriter().registerAgent(agentId);
  },
  { name: 'keto.step.registerAgent', ...ketoStepConfig },
);

// ── Workflows ────────────────────────────────────────────────────────
// Each workflow wraps a single step for now. Can compose multiple
// steps later (e.g., diaryCreated = grantOwnership + publishEvent).

export const grantOwnershipWorkflow = DBOS.registerWorkflow(
  async (entryId: string, agentId: string): Promise<void> => {
    await grantOwnershipStep(entryId, agentId);
  },
  { name: 'keto.grantOwnership' },
);

export const removeEntryRelationsWorkflow = DBOS.registerWorkflow(
  async (entryId: string): Promise<void> => {
    await removeEntryRelationsStep(entryId);
  },
  { name: 'keto.removeEntryRelations' },
);

export const grantViewerWorkflow = DBOS.registerWorkflow(
  async (entryId: string, agentId: string): Promise<void> => {
    await grantViewerStep(entryId, agentId);
  },
  { name: 'keto.grantViewer' },
);

export const revokeViewerWorkflow = DBOS.registerWorkflow(
  async (entryId: string, agentId: string): Promise<void> => {
    await revokeViewerStep(entryId, agentId);
  },
  { name: 'keto.revokeViewer' },
);

export const registerAgentWorkflow = DBOS.registerWorkflow(
  async (agentId: string): Promise<void> => {
    await registerAgentStep(agentId);
  },
  { name: 'keto.registerAgent' },
);

// ── Exported Collection ──────────────────────────────────────────────

export const ketoWorkflows = {
  grantOwnership: grantOwnershipWorkflow,
  removeEntryRelations: removeEntryRelationsWorkflow,
  grantViewer: grantViewerWorkflow,
  revokeViewer: revokeViewerWorkflow,
  registerAgent: registerAgentWorkflow,
};
