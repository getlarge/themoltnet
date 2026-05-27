import { type Static, Type } from '@sinclair/typebox';

import { TaskContext } from '../context.js';
import { SuccessCriteria, VerificationRecord } from '../success-criteria.js';

export const FREEFORM_TYPE = 'freeform' as const;

export const FreeformTaskTypeProposal = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    rationale: Type.String({ minLength: 1 }),
    inputShape: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    outputShape: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { $id: 'FreeformTaskTypeProposal', additionalProperties: false },
);
export type FreeformTaskTypeProposal = Static<typeof FreeformTaskTypeProposal>;

export const FreeformInput = Type.Object(
  {
    /**
     * Optional operator-facing title. The brief remains the source of truth
     * for exploratory intent.
     */
    title: Type.Optional(Type.String({ minLength: 1 })),
    /** Natural-language work request when no narrower task type fits yet. */
    brief: Type.String({ minLength: 1 }),
    /**
     * Optional expectation about the shape or destination of the answer.
     * Kept as prose because this task type is the discovery lane.
     */
    expectedOutput: Type.Optional(Type.String({ minLength: 1 })),
    constraints: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), { maxItems: 20 }),
    ),
    /** Proposer's best guess; does not need to be registered yet. */
    suggestedTaskType: Type.Optional(Type.String({ minLength: 1 })),
    successCriteria: Type.Optional(SuccessCriteria),
    context: Type.Optional(TaskContext),
  },
  { $id: 'FreeformInput', additionalProperties: false },
);
export type FreeformInput = Static<typeof FreeformInput>;

export const FreeformArtifact = Type.Object(
  {
    kind: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String({ minLength: 1 })),
    url: Type.Optional(Type.String({ minLength: 1 })),
    path: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: 'FreeformArtifact', additionalProperties: false },
);
export type FreeformArtifact = Static<typeof FreeformArtifact>;

export const FreeformFollowUpTask = Type.Object(
  {
    title: Type.String({ minLength: 1 }),
    brief: Type.String({ minLength: 1 }),
    suggestedTaskType: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: 'FreeformFollowUpTask', additionalProperties: false },
);
export type FreeformFollowUpTask = Static<typeof FreeformFollowUpTask>;

export const FreeformOutput = Type.Object(
  {
    /** 2-5 sentence result summary. */
    summary: Type.String({ minLength: 1 }),
    artifacts: Type.Optional(Type.Array(FreeformArtifact, { maxItems: 20 })),
    proposedTaskType: Type.Optional(FreeformTaskTypeProposal),
    followUpTasks: Type.Optional(
      Type.Array(FreeformFollowUpTask, { maxItems: 20 }),
    ),
    diaryEntryIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
    /**
     * Required when input.successCriteria is set, including the submit-output
     * gate injected by create-time normalization.
     */
    verification: Type.Optional(VerificationRecord),
  },
  { $id: 'FreeformOutput', additionalProperties: false },
);
export type FreeformOutput = Static<typeof FreeformOutput>;
