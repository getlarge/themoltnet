/**
 * Deterministic, synthetic task-detail fixtures.
 *
 * Illustrative data for the task-ui demo, tests, and screen captures. The
 * project, its requirements, and every identifier are invented: identifiers
 * are derived from fixed labels, not taken from any real task, agent, or
 * diary. Structure follows the freeform output contract in
 * `libs/tasks/src/task-types/freeform.ts`.
 */
import type { TaskKnowledgeEntry } from '../task-knowledge-list.js';
import type { TaskAttemptSummary, TaskSummary } from '../types.js';

const DEMO_IDS = {
  task: 'b23bf6f2-d180-4202-9568-29b602ba9b11',
  team: '2cdc3df7-f5a3-4f2c-b6ad-d93ffb718835',
  diary: '4c904660-bb1d-43ff-8411-96e220eab0e7',
  proposer: 'afd81e17-2c76-4918-b1a5-d1f399f05bce',
  agent: '34c7eae2-f55b-416f-918e-4a003a778574',
  runtime: '3ed0024b-65f2-4577-889e-61bc50200c46',
  runtimeProfile: '9650d78b-bb3e-475c-a86a-5554f6d6d010',
  lease: '2ee26043-1559-446f-9c2f-bcc549711b0c',
  decisionsEntry: 'd745ae53-6f39-4724-a596-785462aa1455',
  methodEntry: '85a0c57a-39c9-4c21-ae31-6b0476b2daa0',
  inputCid: 'bafyreiwdgqcg4m7fcev467abcuuc276lsvyojpickchkvt75wurm4gq4lu',
  inputSchemaCid: 'bafyrei5va7gkgob4muzyvhpa63b4iamquakrupj723xdvvpdrtzq2bzazd',
  outputCid: 'bafyreiz7daw4wx5i5nokrifw6nsof4ngizs3qxm3sht6lhw7bn3xsrn5dr',
  policySnapshot:
    'sha256:e7b13bd66f325555d5ec58a920247062609f099ff4b05f1aa24f7fb25b248e49',
  executorFingerprint: '5136-F393-5F44-7695',
} as const;

/** Human-readable labels a presentation surface shows instead of UUIDs. */
export const DEMO_LABELS: Record<string, string> = {
  [DEMO_IDS.team]: 'Studio team',
  [DEMO_IDS.diary]: 'Project diary',
  [DEMO_IDS.proposer]: 'Operator (human)',
};

const REQUIREMENTS_BODY = [
  '1. Preserve the mature trees and existing stone wall.',
  '   The brief names both as fixed; the footprint has to work around them.',
  '2. Separate the quiet workspace from shared family areas.',
  '   One occupant works from home and asks for acoustic separation from the kitchen and living room.',
  '3. Flag the conflict between west-facing glazing and summer heat.',
  '   Unresolved: the brief wants large west windows for evening light and a house that stays cool in summer.',
].join('\n');

/** The fictional client material the agent is asked to read. */
const SOURCE_BRIEF = [
  'We are renovating our family house. Keep the mature trees and the existing stone wall; the new footprint must work around both.',
  'One of us works from home. Please give the workspace acoustic separation from the kitchen and living room so calls do not interrupt family life.',
  'We love the evening light and would like large west-facing windows. We also need the house to stay cool in summer. We have not chosen between that glazing and additional solar shading; please flag the trade-off for us to decide.',
].join('\n\n');

const successCriteria = {
  version: 1,
  gates: [
    {
      id: 'submit-output',
      kind: 'submit-tool-call',
      description: 'Submit the result through the task output tool.',
      required: true,
    },
  ],
  assertions: [
    { id: 'summary-present', path: 'summary', op: 'exists' },
    {
      id: 'requirements-listed',
      path: 'artifacts.0.body',
      op: 'min-length',
      value: 120,
    },
  ],
  sideEffects: { diaryEntryRequired: true },
};

export const projectBriefTask: TaskSummary = {
  id: DEMO_IDS.task,
  taskType: 'freeform',
  title: 'Project brief · Extract requirements',
  tags: ['project-brief', 'requirements'],
  teamId: DEMO_IDS.team,
  diaryId: DEMO_IDS.diary,
  outputKind: 'artifact',
  input: {
    brief:
      'Read the client brief for a family house renovation and extract the design requirements a later stage can act on. Flag any requirement that conflicts with another.',
    sourceBrief: SOURCE_BRIEF,
    expectedOutput:
      'A short summary and one requirements artifact that states each requirement in plain language.',
    constraints: [
      'Use only the brief; do not invent site facts.',
      'Name unresolved trade-offs instead of resolving them.',
    ],
    successCriteria,
  },
  inputSchemaCid: DEMO_IDS.inputSchemaCid,
  inputCid: DEMO_IDS.inputCid,
  references: [],
  correlationId: null,
  proposedByAgentId: null,
  proposedByHumanId: DEMO_IDS.proposer,
  acceptedAttemptN: 1,
  claimCondition: null,
  requiredExecutorTrustLevel: 'agentSigned',
  allowedProfiles: [{ profileId: DEMO_IDS.runtimeProfile }],
  status: 'completed',
  queuedAt: '2026-09-14T08:58:12.000Z',
  completedAt: '2026-09-14T09:09:27.000Z',
  expiresAt: '2026-09-15T08:58:12.000Z',
  cancelledByAgentId: null,
  cancelledByHumanId: null,
  cancelReason: null,
  maxAttempts: 2,
  dispatchTimeoutSec: 300,
  runningTimeoutSec: 1800,
};

export const projectBriefOutput = {
  summary:
    'The agent extracted three design requirements from the supplied brief and flagged the west-facing glazing and summer-heat trade-off for the client. The task checks confirmed the required output shape and diary side effect; the design itself awaits review.',
  artifacts: [
    {
      kind: 'requirements',
      title: 'Extracted requirements',
      description:
        'Requirements from the fictional client brief, in source order.',
      contentType: 'text/markdown',
      body: REQUIREMENTS_BODY,
    },
  ],
  diaryEntryIds: [DEMO_IDS.decisionsEntry],
  verification: {
    inputCid: DEMO_IDS.inputCid,
    passed: true,
    results: [
      {
        id: 'submit-output',
        kind: 'gate',
        status: 'pass',
        detail: 'Output submitted through the task output tool.',
      },
      {
        id: 'summary-present',
        kind: 'assertion',
        status: 'pass',
        detail: 'summary exists.',
      },
      {
        id: 'requirements-listed',
        kind: 'assertion',
        status: 'pass',
        detail: 'artifacts.0.body is 459 characters (minimum 120).',
      },
      {
        id: 'diary-entry',
        kind: 'sideEffect',
        status: 'pass',
        detail: 'Two task-tagged diary entries written.',
      },
    ],
  },
};

export const projectBriefAttempt: TaskAttemptSummary = {
  taskId: DEMO_IDS.task,
  attemptN: 1,
  claimedByAgentId: DEMO_IDS.agent,
  runtimeId: DEMO_IDS.runtime,
  runtimeProfileId: DEMO_IDS.runtimeProfile,
  runtimeProfileRevision: 3,
  policySnapshotHash: DEMO_IDS.policySnapshot,
  leaseId: DEMO_IDS.lease,
  claimedAt: '2026-09-14T09:01:40.000Z',
  startedAt: '2026-09-14T09:01:44.000Z',
  completedAt: '2026-09-14T09:09:27.000Z',
  status: 'completed',
  output: projectBriefOutput,
  outputCid: DEMO_IDS.outputCid,
  claimedExecutorFingerprint: DEMO_IDS.executorFingerprint,
  claimedExecutorManifest: null,
  completedExecutorFingerprint: DEMO_IDS.executorFingerprint,
  completedExecutorManifest: null,
  error: null,
  usage: {
    inputTokens: 18_420,
    outputTokens: 1_236,
    cacheReadTokens: 9_870,
    toolCalls: 7,
  },
  contentSignature: null,
  signedAt: null,
};

/** Provenance tags the executor sets on task-scoped entries (docs/use/entries.md). */
function attemptTags(attemptN: number): string[] {
  return [
    `task:id:${DEMO_IDS.task}`,
    'task:type:freeform',
    `task:attempt:${attemptN}`,
  ];
}

export const projectBriefKnowledge: TaskKnowledgeEntry[] = [
  {
    id: DEMO_IDS.decisionsEntry,
    title: 'Brief observations for the concept stage',
    tags: attemptTags(1),
    entryType: 'semantic',
    createdAt: '2026-09-14T09:07:51.000Z',
    signed: true,
    content:
      'The brief treats trees and the stone wall as fixed site constraints and asks for an acoustically separate workspace. The west-facing glazing and summer-heat trade-off remains open for the client; no design choice was approved.',
  },
  {
    id: DEMO_IDS.methodEntry,
    title: 'Separate stated constraints from preferences when reading a brief',
    tags: attemptTags(1),
    entryType: 'procedural',
    createdAt: '2026-09-14T09:08:40.000Z',
    signed: true,
    content:
      'List hard constraints first, then mark each preference as negotiable. Doing so kept the extraction short and made the one real conflict visible.',
  },
];

export type TaskDetailScenarioId =
  | 'accepted'
  | 'queued'
  | 'running'
  | 'failed'
  | 'unknown-output'
  | 'no-knowledge'
  | 'long-content';

export interface TaskDetailScenario {
  id: TaskDetailScenarioId;
  label: string;
  task: TaskSummary;
  attempts: TaskAttemptSummary[];
  knowledge: TaskKnowledgeEntry[];
}

const openTask: TaskSummary = {
  ...projectBriefTask,
  acceptedAttemptN: null,
  completedAt: null,
};

const LONG_BRIEF = [
  projectBriefTask.input.brief as string,
  '',
  'The brief is eleven pages long. It mixes site facts, budget notes, and the family routines the house has to support, and several sections repeat the same wish in different words. Treat the site survey appendix as authoritative for dimensions, and the client letter as authoritative for priorities.',
  '',
  'Where the brief contradicts itself, record both statements and the page they come from. Do not choose between them: the next stage decides with the client. Leave out anything that describes the house as it is today rather than as it should become.',
].join('\n');

const LONG_SUMMARY = `${projectBriefOutput.summary} The brief ran to eleven pages and mixed site facts, budget notes, and family routines, so the agent kept each requirement tied to the passage it came from and dropped statements that described the current house rather than the intended one. Two requirements the client repeated in different words were merged, and one wish list item that contradicted the stated budget was left as a preference rather than promoted to a requirement.`;

const LONG_BODY = [
  REQUIREMENTS_BODY,
  ...Array.from({ length: 9 }, (_, index) =>
    [
      `${index + 4}. Secondary requirement ${index + 4} from the brief, kept in the client’s own ranking.`,
      '   Recorded so later stages can check it against the concept without rereading the whole brief.',
    ].join('\n'),
  ),
].join('\n');

export const taskDetailScenarios: Record<
  TaskDetailScenarioId,
  TaskDetailScenario
> = {
  accepted: {
    id: 'accepted',
    label: 'Accepted result',
    task: projectBriefTask,
    attempts: [projectBriefAttempt],
    knowledge: projectBriefKnowledge,
  },
  queued: {
    id: 'queued',
    label: 'Queued',
    task: { ...openTask, status: 'queued' },
    attempts: [],
    knowledge: [],
  },
  running: {
    id: 'running',
    label: 'Running',
    task: { ...openTask, status: 'running' },
    attempts: [
      {
        ...projectBriefAttempt,
        status: 'running',
        completedAt: null,
        output: null,
        outputCid: null,
        completedExecutorFingerprint: null,
        contentSignature: null,
        signedAt: null,
      },
    ],
    knowledge: projectBriefKnowledge.slice(1),
  },
  failed: {
    id: 'failed',
    label: 'Failed attempt',
    task: { ...openTask, status: 'queued' },
    attempts: [
      {
        ...projectBriefAttempt,
        status: 'failed',
        output: null,
        outputCid: null,
        contentSignature: null,
        signedAt: null,
        completedAt: '2026-09-14T09:04:10.000Z',
        error: {
          code: 'OUTPUT_SCHEMA_INVALID',
          message:
            'Output rejected: artifacts[0].title must be a non-empty string.',
          retryable: true,
        },
      },
    ],
    knowledge: [
      {
        id: '5f0c2a91-7d4e-4b8a-9c3f-1e6d8b2a4c70',
        title: 'Artifact titles are required by the output schema',
        entryType: 'episodic',
        createdAt: '2026-09-14T09:04:02.000Z',
        signed: true,
        tags: attemptTags(1),
        content:
          'Submission was rejected because an artifact had an empty title. Give every artifact a title before submitting.',
      },
    ],
  },
  'unknown-output': {
    id: 'unknown-output',
    label: 'Unfamiliar output type',
    task: {
      ...projectBriefTask,
      taskType: 'site_survey_digest',
      title: 'Site survey · Digest measurements',
    },
    attempts: [
      {
        ...projectBriefAttempt,
        output: {
          summary:
            'Survey measurements were grouped by room and checked against the drawing set; two dimensions disagree by more than the stated tolerance.',
          rooms: 9,
          discrepancies: [
            { room: 'Kitchen', deltaMm: 45 },
            { room: 'Study', deltaMm: 30 },
          ],
          toleranceMm: 20,
          drawingSet: 'rev-C',
        },
      },
    ],
    knowledge: projectBriefKnowledge.slice(0, 1),
  },
  'no-knowledge': {
    id: 'no-knowledge',
    label: 'No criteria, no knowledge',
    task: {
      ...projectBriefTask,
      input: {
        brief: projectBriefTask.input.brief,
        expectedOutput: projectBriefTask.input.expectedOutput,
      },
    },
    attempts: [
      {
        ...projectBriefAttempt,
        output: {
          ...projectBriefOutput,
          diaryEntryIds: [],
          verification: undefined,
        },
      },
    ],
    knowledge: [],
  },
  'long-content': {
    id: 'long-content',
    label: 'Long content, sparse fields',
    task: {
      ...projectBriefTask,
      input: { ...projectBriefTask.input, brief: LONG_BRIEF },
    },
    attempts: [
      {
        ...projectBriefAttempt,
        output: {
          ...projectBriefOutput,
          summary: LONG_SUMMARY,
          artifacts: [
            { ...projectBriefOutput.artifacts[0], body: LONG_BODY },
            {
              kind: 'drawing',
              title: 'Annotated site plan',
              contentType: 'application/pdf',
              cid: 'bafyreid6mc7maao6t5lyv2qwdkcsjnonupj6smlj4l74j7j5z464scujnc',
              sizeBytes: 1_482_113,
            },
            { kind: 'note', title: 'Open questions for the client' },
          ],
        },
      },
    ],
    knowledge: projectBriefKnowledge,
  },
};
