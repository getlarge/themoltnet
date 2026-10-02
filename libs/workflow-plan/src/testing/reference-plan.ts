/**
 * Hand-authored reference plan for the synthetic evidence-synthesis workflow.
 * It isolates execution correctness from planner quality: every dependency,
 * binding, gate option, and policy is explicit.
 */
import type { WorkflowPlan } from '../plan/schema.js';

export const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['set', 'findings'],
  additionalProperties: false,
  properties: {
    set: { type: 'string', enum: ['A', 'B'] },
    findings: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['claim', 'cites'],
        additionalProperties: false,
        properties: {
          claim: { type: 'string', minLength: 1 },
          cites: { type: 'array', minItems: 1, items: { type: 'string' } },
        },
      },
    },
  },
} as const;

export const SYNTHESIS_SCHEMA = {
  type: 'object',
  required: ['statements'],
  additionalProperties: false,
  properties: {
    statements: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['text', 'cites'],
        additionalProperties: false,
        properties: {
          text: { type: 'string', minLength: 1 },
          cites: { type: 'array', minItems: 1, items: { type: 'string' } },
        },
      },
    },
  },
} as const;

export const SUMMARY_SCHEMA = {
  type: 'object',
  required: ['summary', 'basedOnSynthesisRevision'],
  additionalProperties: false,
  properties: {
    summary: { type: 'string', minLength: 1 },
    basedOnSynthesisRevision: { type: 'integer', minimum: 1 },
  },
} as const;

export function referencePlan(
  overrides: Partial<Pick<WorkflowPlan, 'planId' | 'scope'>> = {},
): WorkflowPlan {
  return {
    schemaVersion: 1,
    planId: overrides.planId ?? 'evidence-synthesis-reference',
    revision: 1,
    title: 'Evidence synthesis with a human decision gate',
    scope: overrides.scope ?? {
      teamId: 'team-synthetic',
      diaryId: 'diary-synthetic',
      correlationId: 'corr-synthetic',
    },
    process: {
      owner: 'process-owner',
      activities: [
        {
          id: 'collect',
          description:
            'Two analysts each read one evidence set and list cited findings.',
          executionOwner: 'agent',
          status: 'proposal',
        },
        {
          id: 'synthesize',
          description:
            'A lead merges both lists into statements that cite both sets.',
          executionOwner: 'agent',
          status: 'proposal',
        },
        {
          id: 'decide',
          description:
            'The process owner approves, asks for a revision, or rejects the synthesis.',
          executionOwner: 'person',
          status: 'decision',
        },
        {
          id: 'summarize',
          description:
            'A final summary is written only from an approved synthesis revision.',
          executionOwner: 'agent',
          status: 'proposal',
        },
      ],
    },
    nodes: [
      {
        id: 'process-a',
        kind: 'task',
        title: 'Process evidence set A',
        dependsOn: [],
        taskType: 'freeform',
        brief:
          'Read evidence set A and list findings; every finding cites item ids from set A only.',
        inputs: {
          evidence: {
            kind: 'artifact',
            cid: 'cid-set-a',
            contentType: 'application/json',
          },
        },
        output: {
          schema: FINDINGS_SCHEMA,
          domainChecks: ['citations-resolve'],
        },
        authority: { allowedProfiles: [], selectedSkills: ['research-craft'] },
        recovery: { maxAttempts: 2, maxRepairs: 2, onExhausted: 'block' },
        commitment: 'committed',
      },
      {
        id: 'process-b',
        kind: 'task',
        title: 'Process evidence set B',
        dependsOn: [],
        taskType: 'freeform',
        brief:
          'Read evidence set B and list findings; every finding cites item ids from set B only.',
        inputs: {
          evidence: {
            kind: 'artifact',
            cid: 'cid-set-b',
            contentType: 'application/json',
          },
        },
        output: {
          schema: FINDINGS_SCHEMA,
          domainChecks: ['citations-resolve'],
        },
        authority: { allowedProfiles: [], selectedSkills: ['research-craft'] },
        recovery: { maxAttempts: 2, maxRepairs: 2, onExhausted: 'block' },
        commitment: 'committed',
      },
      {
        id: 'synthesize',
        kind: 'task',
        title: 'Synthesize findings from both sets',
        dependsOn: ['process-a', 'process-b'],
        taskType: 'freeform',
        brief:
          'Merge both findings documents into statements. Each statement cites ids from both sets where possible.',
        inputs: {
          findingsA: { kind: 'output', node: 'process-a' },
          findingsB: { kind: 'output', node: 'process-b' },
        },
        output: {
          schema: SYNTHESIS_SCHEMA,
          domainChecks: ['citations-resolve'],
        },
        authority: {
          allowedProfiles: [],
          selectedSkills: ['recursive-synthesis'],
        },
        recovery: {
          maxAttempts: 2,
          maxRepairs: 2,
          onExhausted: 'escalate_to_human',
        },
        commitment: 'committed',
      },
      {
        id: 'owner-decision',
        kind: 'human_gate',
        title: 'Process owner reviews the synthesis',
        dependsOn: ['synthesize'],
        reviews: { node: 'synthesize' },
        options: ['approve', 'request_revision', 'reject'],
        decider: { role: 'process-owner', attestation: 'attributed_note' },
        revisionTarget: 'synthesize',
        maxRevisions: 2,
        wait: { pollIntervalSec: 5 },
      },
      {
        id: 'final-summary',
        kind: 'task',
        title: 'Write the final summary from the approved synthesis',
        dependsOn: ['owner-decision', 'synthesize'],
        taskType: 'freeform',
        brief:
          'Write a short summary strictly from the approved synthesis revision.',
        inputs: {
          synthesis: { kind: 'output', node: 'synthesize' },
          decision: { kind: 'decision', node: 'owner-decision' },
        },
        output: { schema: SUMMARY_SCHEMA },
        authority: {
          allowedProfiles: [],
          selectedSkills: ['output-contract-enforcer'],
        },
        recovery: { maxAttempts: 1, maxRepairs: 1, onExhausted: 'block' },
        commitment: 'committed',
      },
    ],
    gateEdges: [
      { from: 'owner-decision', when: 'approve', to: 'final-summary' },
    ],
    termination: {
      successNodes: ['final-summary'],
      maxTotalTasks: 12,
      maxPlanRevisions: 1,
      cancellableBy: ['process-owner'],
    },
    provenance: { source: 'hand_authored', acceptedBy: 'process-owner' },
  };
}
