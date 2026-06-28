/**
 * Task MCP tool schemas.
 *
 * Inputs use snake_case for MCP ergonomics and are mapped to the camelCase
 * REST API client shapes in task-tools.ts.
 */

import type {
  CreateTaskData,
  CreateTaskResponses,
  DownloadTaskArtifactData,
  DownloadTaskArtifactResponses,
  GetTaskData,
  GetTaskResponses,
  ListTaskArtifactsData,
  ListTaskArtifactsResponses,
  ListTaskAttemptsData,
  ListTaskAttemptsResponses,
  ListTaskMessagesData,
  ListTaskMessagesResponses,
  ListTaskSchemasResponses,
  ListTasksResponses,
  UploadTaskArtifactData,
  UploadTaskArtifactResponses,
} from '@moltnet/api-client';
import {
  ClaimConditionDefinition,
  ExecutorTrustLevel,
  RuntimeProfileRef,
  SuccessCriteria,
  Task,
  TaskAttempt,
  TaskMessage,
  TaskRef,
} from '@moltnet/tasks';
import type { Static } from 'typebox';
import { Type } from 'typebox';

import type {
  AssertOutputMatchesApi,
  AssertSchemaToApi,
  BodyOf,
  PathOf,
  QueryOf,
  ResponseOf,
  TeamIdHeaderOf,
} from './common.js';

export const TasksSchemasInputSchema = Type.Object({});
export type TasksSchemasInput = {};

// Keep the MCP tool surface self-contained. Reusing the named `TaskStatus`
// schema here would embed a `$id`-bearing reference into multiple tool
// definitions, which can make AJV-based MCP clients reject `tools/list`.
const TaskStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('waiting'),
  Type.Literal('dispatched'),
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('expired'),
]);

export const TaskCreateSchema = Type.Object({
  task_type: Type.String({
    minLength: 1,
    description: 'Registered task type, e.g. curate_pack or judge_pack.',
  }),
  team_id: Type.String({
    format: 'uuid',
    description: 'Team ID that owns the task.',
  }),
  diary_id: Type.String({
    format: 'uuid',
    description: 'Diary ID the task is proposed against.',
  }),
  input: Type.Record(Type.String(), Type.Unknown(), {
    description: 'Task-type-specific input payload.',
  }),
  references: Type.Optional(
    Type.Array(TaskRef, {
      description: 'References to prior tasks or external artifacts.',
    }),
  ),
  allowed_profiles: Type.Optional(
    Type.Array(RuntimeProfileRef, {
      description:
        'Restrict claim eligibility to these runtime profile IDs. ' +
        'Daemons using another profile will not receive or claim the task.',
    }),
  ),
  correlation_id: Type.Optional(
    Type.String({
      format: 'uuid',
      description: 'Optional correlation ID for grouping related tasks.',
    }),
  ),
  max_attempts: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: 'Maximum number of delivery attempts. Defaults to 1.',
    }),
  ),
  expires_in_sec: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: 'Relative expiry in seconds.',
    }),
  ),
  required_executor_trust_level: Type.Optional(ExecutorTrustLevel),
  dispatch_timeout_sec: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 86400,
      description: 'Optional dispatch timeout override in seconds.',
    }),
  ),
  running_timeout_sec: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 86400,
      description: 'Optional running timeout override in seconds.',
    }),
  ),
});
type CreateTaskBody = BodyOf<CreateTaskData>;
export type TaskCreateInput = {
  task_type: CreateTaskBody['taskType'];
  team_id: TeamIdHeaderOf<CreateTaskData>;
  diary_id: CreateTaskBody['diaryId'];
  input: CreateTaskBody['input'];
  references?: CreateTaskBody['references'];
  allowed_profiles?: CreateTaskBody['allowedProfiles'];
  correlation_id?: CreateTaskBody['correlationId'];
  max_attempts?: CreateTaskBody['maxAttempts'];
  expires_in_sec?: CreateTaskBody['expiresInSec'];
  required_executor_trust_level?: CreateTaskBody['requiredExecutorTrustLevel'];
  dispatch_timeout_sec?: CreateTaskBody['dispatchTimeoutSec'];
  running_timeout_sec?: CreateTaskBody['runningTimeoutSec'];
};
type _TaskCreateInputMatchesApi = AssertSchemaToApi<
  Static<typeof TaskCreateSchema>,
  TaskCreateInput
>;

/**
 * Input schema for the `tasks_continue` MCP tool. Unlike the other task
 * tools this one is composed client-side: the handler reads the source
 * task via `tasks_get`, builds a `freeform` CreateTaskRequest with
 * `input.continueFrom` set, and POSTs it through `tasks_create`. There
 * is no dedicated server endpoint — see issue #1287.
 *
 * Keys use camelCase here (rather than the snake_case convention used by
 * the rest of the task tool surface) because every field maps 1:1 onto
 * the `freeform` task input shape and we want the MCP surface to read
 * the same as the wire schema for the continuation code path.
 */
export const TaskContinueSchema = Type.Object(
  {
    fromTaskId: Type.String({
      format: 'uuid',
      description: 'ID of the source freeform task to continue from.',
    }),
    fromAttemptN: Type.Integer({
      minimum: 1,
      description: 'Attempt number on the source task to resume.',
    }),
    brief: Type.String({
      minLength: 1,
      description:
        'New work request for the continuation. The daemon resumes the source attempt conversation and applies this brief as the next user turn.',
    }),
    title: Type.Optional(Type.String({ minLength: 1 })),
    expectedOutput: Type.Optional(Type.String({ minLength: 1 })),
    constraints: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), { maxItems: 20 }),
    ),
    // execution.workspace deliberately omitted: workspace mode for a
    // continuation is derived from parent runtime context by the daemon.
    // Any caller-supplied override would be silently ignored at the daemon
    // plan stage, so the server-side validator rejects it explicitly when
    // continueFrom + execution are both set on the constructed input.
    successCriteria: Type.Optional(SuccessCriteria),
    mode: Type.Optional(
      Type.Union([Type.Literal('extend'), Type.Literal('fork')], {
        description:
          "Continuation mode. 'extend' (default) continues the parent conversation and branch when branch metadata is available. 'fork' cuts a NEW branch from the parent's tip into a fresh worktree, diverging into a separate PR. Both copy the parent Pi session.",
      }),
    ),
  },
  { additionalProperties: false },
);
export type TaskContinueInput = Static<typeof TaskContinueSchema>;

export const TaskGetSchema = Type.Object({
  id: Type.String({
    format: 'uuid',
    description: 'Task ID.',
  }),
});
export type TaskGetInput = {
  id: PathOf<GetTaskData>['id'];
};

export const TaskListSchema = Type.Object({
  team_id: Type.String({
    format: 'uuid',
    description: 'Team ID to list tasks for.',
  }),
  status: Type.Optional(TaskStatusSchema),
  task_type: Type.Optional(
    Type.String({
      minLength: 1,
      description: 'Optional task type filter.',
    }),
  ),
  correlation_id: Type.Optional(
    Type.String({
      format: 'uuid',
      description: 'Optional correlation ID filter.',
    }),
  ),
  diary_id: Type.Optional(
    Type.String({
      format: 'uuid',
      description: 'Optional diary ID filter.',
    }),
  ),
  proposed_by_agent_id: Type.Optional(
    Type.String({
      format: 'uuid',
      description: 'Optional proposer agent ID filter.',
    }),
  ),
  proposed_by_human_id: Type.Optional(
    Type.String({
      format: 'uuid',
      description: 'Optional proposer human ID filter.',
    }),
  ),
  claimed_by_agent_id: Type.Optional(
    Type.String({
      format: 'uuid',
      description:
        'Optional worker agent ID filter. Matches tasks with at least one attempt claimed by this agent.',
    }),
  ),
  has_attempts: Type.Optional(
    Type.Boolean({
      description:
        'When true, only return tasks with attempts. When false, only return tasks with no attempts.',
    }),
  ),
  queued_after: Type.Optional(
    Type.String({
      format: 'date-time',
      description: 'Only return tasks queued at or after this timestamp.',
    }),
  ),
  queued_before: Type.Optional(
    Type.String({
      format: 'date-time',
      description: 'Only return tasks queued before this timestamp.',
    }),
  ),
  completed_after: Type.Optional(
    Type.String({
      format: 'date-time',
      description: 'Only return tasks completed at or after this timestamp.',
    }),
  ),
  completed_before: Type.Optional(
    Type.String({
      format: 'date-time',
      description: 'Only return tasks completed before this timestamp.',
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 100,
      description: 'Maximum tasks to return. Defaults to the REST API value.',
    }),
  ),
  cursor: Type.Optional(
    Type.String({
      description: 'Pagination cursor from a previous tasks_list response.',
    }),
  ),
});
export type TaskListInput = Static<typeof TaskListSchema>;
type _TaskListInputMatchesApi = AssertSchemaToApi<
  Static<typeof TaskListSchema>,
  TaskListInput
>;

export const TaskAttemptsListSchema = Type.Object({
  task_id: Type.String({
    format: 'uuid',
    description: 'Task ID.',
  }),
});
export type TaskAttemptsListInput = {
  task_id: PathOf<ListTaskAttemptsData>['id'];
};

export const TaskMessagesListSchema = Type.Object({
  task_id: Type.String({
    format: 'uuid',
    description: 'Task ID.',
  }),
  attempt_n: Type.Integer({
    minimum: 1,
    description: 'Attempt number.',
  }),
  after_seq: Type.Optional(
    Type.Integer({
      minimum: 0,
      description: 'Exclusive message sequence cursor.',
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 200,
      description: 'Maximum messages to return.',
    }),
  ),
});
type ListMessagesPath = PathOf<ListTaskMessagesData>;
type ListMessagesQuery = QueryOf<ListTaskMessagesData>;
export type TaskMessagesListInput = {
  task_id: ListMessagesPath['id'];
  attempt_n: ListMessagesPath['n'];
  after_seq?: ListMessagesQuery['afterSeq'];
  limit?: ListMessagesQuery['limit'];
};
type _TaskMessagesListInputMatchesApi = AssertSchemaToApi<
  Static<typeof TaskMessagesListSchema>,
  TaskMessagesListInput
>;

export const TaskArtifactsListSchema = Type.Object({
  task_id: Type.String({
    format: 'uuid',
    description: 'Task ID.',
  }),
  team_id: Type.String({
    format: 'uuid',
    description: 'Team ID that owns the task.',
  }),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 100,
      description:
        'Maximum artifacts to return. Defaults to the REST API value.',
    }),
  ),
  cursor: Type.Optional(
    Type.String({
      description:
        'Pagination cursor from a previous tasks_artifacts_list response.',
    }),
  ),
});
type ListArtifactsPath = PathOf<ListTaskArtifactsData>;
type ListArtifactsQuery = QueryOf<ListTaskArtifactsData>;
export type TaskArtifactsListInput = {
  task_id: ListArtifactsPath['taskId'];
  team_id: TeamIdHeaderOf<ListTaskArtifactsData>;
  limit?: ListArtifactsQuery['limit'];
  cursor?: ListArtifactsQuery['cursor'];
};
type _TaskArtifactsListInputMatchesApi = AssertSchemaToApi<
  Static<typeof TaskArtifactsListSchema>,
  TaskArtifactsListInput
>;

export const TaskArtifactUploadSchema = Type.Object({
  task_id: Type.String({
    format: 'uuid',
    description: 'Task ID.',
  }),
  attempt_n: Type.Integer({
    minimum: 1,
    description: 'Attempt number.',
  }),
  team_id: Type.String({
    format: 'uuid',
    description: 'Team ID that owns the task.',
  }),
  kind: Type.String({
    minLength: 1,
    description: 'Artifact kind, e.g. report, diff, trace.',
  }),
  title: Type.String({
    minLength: 1,
    description: 'Artifact title, usually a filename.',
  }),
  content_base64: Type.String({
    minLength: 1,
    description: 'Base64-encoded artifact bytes.',
  }),
  content_type: Type.Optional(
    Type.String({
      minLength: 1,
      description: 'Content type metadata, e.g. text/markdown.',
    }),
  ),
  content_encoding: Type.Optional(
    Type.String({
      minLength: 1,
      description: 'Optional content encoding metadata, e.g. gzip.',
    }),
  ),
});
type UploadArtifactPath = PathOf<UploadTaskArtifactData>;
type UploadArtifactQuery = QueryOf<UploadTaskArtifactData>;
export type TaskArtifactUploadInput = {
  task_id: UploadArtifactPath['taskId'];
  attempt_n: UploadArtifactPath['attemptN'];
  team_id: TeamIdHeaderOf<UploadTaskArtifactData>;
  kind: UploadArtifactQuery['kind'];
  title: UploadArtifactQuery['title'];
  content_base64: string;
  content_type?: UploadArtifactQuery['contentType'];
  content_encoding?: UploadArtifactQuery['contentEncoding'];
};

export const TaskArtifactDownloadSchema = Type.Object({
  task_id: Type.String({
    format: 'uuid',
    description: 'Task ID.',
  }),
  attempt_n: Type.Integer({
    minimum: 1,
    description: 'Attempt number.',
  }),
  team_id: Type.String({
    format: 'uuid',
    description: 'Team ID that owns the task.',
  }),
  cid: Type.String({
    minLength: 1,
    description: 'Artifact CID.',
  }),
});
type DownloadArtifactPath = PathOf<DownloadTaskArtifactData>;
export type TaskArtifactDownloadInput = {
  task_id: DownloadArtifactPath['taskId'];
  attempt_n: DownloadArtifactPath['attemptN'];
  team_id: TeamIdHeaderOf<DownloadTaskArtifactData>;
  cid: DownloadArtifactPath['cid'];
};
type _TaskArtifactDownloadInputMatchesApi = AssertSchemaToApi<
  Static<typeof TaskArtifactDownloadSchema>,
  TaskArtifactDownloadInput
>;

export const TaskConsoleLinkSchema = Type.Object({
  id: Type.String({
    format: 'uuid',
    description: 'Task ID.',
  }),
});
export type TaskConsoleLinkInput = {
  id: string;
};

const TaskWithConsoleUrlSchema = Type.Object(
  {
    ...Task.properties,
    consoleUrl: Type.Optional(Type.String()),
  },
  {
    $defs: {
      ClaimCondition: ClaimConditionDefinition,
    },
    additionalProperties: false,
  },
);

export const TaskOutputSchema = TaskWithConsoleUrlSchema;

export const TaskListOutputSchema = Type.Object({
  items: Type.Array(TaskWithConsoleUrlSchema),
  total: Type.Integer({ minimum: 0 }),
  nextCursor: Type.Optional(Type.String()),
});

export const TaskAttemptsListOutputSchema = Type.Object({
  items: Type.Array(TaskAttempt),
});
export const TaskMessagesListOutputSchema = Type.Object({
  items: Type.Array(TaskMessage),
});

const TaskArtifactMetadataSchema = Type.Object({
  id: Type.String(),
  teamId: Type.String(),
  taskId: Type.String(),
  attemptN: Type.Integer(),
  kind: Type.String(),
  title: Type.String(),
  contentType: Type.String(),
  contentEncoding: Type.Union([Type.String(), Type.Null()]),
  sizeBytes: Type.Integer({ minimum: 0 }),
  cid: Type.String(),
  createdByAgentId: Type.String(),
  expiresAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});

export const TaskArtifactsListOutputSchema = Type.Object({
  artifacts: Type.Array(TaskArtifactMetadataSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
});
export const TaskArtifactUploadOutputSchema = TaskArtifactMetadataSchema;
export const TaskArtifactDownloadOutputSchema = Type.Object({
  artifactId: Type.Union([Type.String(), Type.Null()]),
  cid: Type.Union([Type.String(), Type.Null()]),
  contentType: Type.Union([Type.String(), Type.Null()]),
  contentEncoding: Type.Union([Type.String(), Type.Null()]),
  contentBase64: Type.String(),
});

export const TaskConsoleLinkOutputSchema = Type.Object({
  id: Type.String(),
  consoleUrl: Type.Optional(Type.String()),
});

const TaskAppOpenFiltersOutputSchema = Type.Object({
  team_id: Type.Optional(Type.String()),
  status: Type.Optional(TaskStatusSchema),
  task_type: Type.Optional(Type.String()),
  correlation_id: Type.Optional(Type.String()),
  diary_id: Type.Optional(Type.String()),
  proposed_by_agent_id: Type.Optional(Type.String()),
  proposed_by_human_id: Type.Optional(Type.String()),
  claimed_by_agent_id: Type.Optional(Type.String()),
  has_attempts: Type.Optional(Type.Boolean()),
  queued_after: Type.Optional(Type.String()),
  queued_before: Type.Optional(Type.String()),
  completed_after: Type.Optional(Type.String()),
  completed_before: Type.Optional(Type.String()),
});

export const TaskAppOpenSchema = Type.Object({
  team_id: Type.Optional(
    Type.String({
      format: 'uuid',
      description: 'Optional team ID used to pre-load the queue.',
    }),
  ),
  task_id: Type.Optional(
    Type.String({
      format: 'uuid',
      description: 'Optional task ID used to pre-load the detail panel.',
    }),
  ),
  status: Type.Optional(TaskStatusSchema),
  task_type: Type.Optional(
    Type.String({
      minLength: 1,
      description: 'Optional task type filter used to pre-load the queue.',
    }),
  ),
  correlation_id: Type.Optional(
    Type.String({
      format: 'uuid',
      description: 'Optional correlation ID filter used to pre-load the queue.',
    }),
  ),
  diary_id: Type.Optional(
    Type.String({
      format: 'uuid',
      description: 'Optional diary ID filter used to pre-load the queue.',
    }),
  ),
  proposed_by_agent_id: Type.Optional(
    Type.String({
      format: 'uuid',
      description:
        'Optional proposer agent ID filter used to pre-load the queue.',
    }),
  ),
  proposed_by_human_id: Type.Optional(
    Type.String({
      format: 'uuid',
      description:
        'Optional proposer human ID filter used to pre-load the queue.',
    }),
  ),
  claimed_by_agent_id: Type.Optional(
    Type.String({
      format: 'uuid',
      description:
        'Optional worker agent ID filter used to pre-load the queue.',
    }),
  ),
  has_attempts: Type.Optional(
    Type.Boolean({
      description:
        'Optional attempt-presence filter used to pre-load the queue.',
    }),
  ),
  queued_after: Type.Optional(
    Type.String({
      format: 'date-time',
      description: 'Optional queued-at lower bound used to pre-load the queue.',
    }),
  ),
  queued_before: Type.Optional(
    Type.String({
      format: 'date-time',
      description: 'Optional queued-at upper bound used to pre-load the queue.',
    }),
  ),
  completed_after: Type.Optional(
    Type.String({
      format: 'date-time',
      description:
        'Optional completed-at lower bound used to pre-load the queue.',
    }),
  ),
  completed_before: Type.Optional(
    Type.String({
      format: 'date-time',
      description:
        'Optional completed-at upper bound used to pre-load the queue.',
    }),
  ),
  console_url: Type.Optional(
    Type.String({
      description: 'Optional explicit console URL for the selected task.',
    }),
  ),
});
export type TaskAppOpenInput = Static<typeof TaskAppOpenSchema>;

export const TaskAppOpenOutputSchema = Type.Object({
  app: Type.Literal('moltnet_tasks'),
  resourceUri: Type.String(),
  teamId: Type.Optional(Type.String()),
  taskId: Type.Optional(Type.String()),
  status: Type.Optional(TaskStatusSchema),
  filters: Type.Optional(TaskAppOpenFiltersOutputSchema),
  consoleUrl: Type.Optional(Type.String()),
  tools: Type.Array(Type.String()),
});
export type TaskAppOpenOutput = Static<typeof TaskAppOpenOutputSchema>;

const TaskTypeDescriptorSchema = Type.Object({
  taskType: Type.String(),
  outputKind: Type.Union([Type.Literal('artifact'), Type.Literal('judgment')]),
  inputSchemaCid: Type.String(),
  inputSchema: Type.Record(Type.String(), Type.Unknown()),
});

export const TaskSchemasOutputSchema = Type.Object({
  items: Type.Array(TaskTypeDescriptorSchema),
});

type TaskWithConsoleUrl = ResponseOf<CreateTaskResponses> & {
  consoleUrl?: string;
};
const _TaskCreateOutputMatchesApi: AssertOutputMatchesApi<
  Static<typeof TaskOutputSchema>,
  TaskWithConsoleUrl
> = true;
const _TaskGetOutputMatchesApi: AssertOutputMatchesApi<
  Static<typeof TaskOutputSchema>,
  ResponseOf<GetTaskResponses> & { consoleUrl?: string }
> = true;
const _TaskListOutputMatchesApi: AssertOutputMatchesApi<
  Static<typeof TaskListOutputSchema>,
  Omit<ResponseOf<ListTasksResponses>, 'items'> & {
    items: TaskWithConsoleUrl[];
  }
> = true;
const _TaskAttemptsOutputMatchesApi: AssertOutputMatchesApi<
  Static<typeof TaskAttemptsListOutputSchema>,
  { items: ResponseOf<ListTaskAttemptsResponses> }
> = true;
const _TaskMessagesOutputMatchesApi: AssertOutputMatchesApi<
  Static<typeof TaskMessagesListOutputSchema>,
  { items: ResponseOf<ListTaskMessagesResponses> }
> = true;
const _TaskArtifactsListOutputMatchesApi: AssertOutputMatchesApi<
  Static<typeof TaskArtifactsListOutputSchema>,
  ResponseOf<ListTaskArtifactsResponses>
> = true;
const _TaskArtifactUploadOutputMatchesApi: AssertOutputMatchesApi<
  Static<typeof TaskArtifactUploadOutputSchema>,
  ResponseOf<UploadTaskArtifactResponses>
> = true;
type TaskArtifactDownloadOutput = Omit<
  Static<typeof TaskArtifactDownloadOutputSchema>,
  'contentBase64'
> & {
  contentBase64: string;
};
type _TaskArtifactDownloadOutputIncludesApi =
  ResponseOf<DownloadTaskArtifactResponses> extends Blob | File ? true : never;
const _TaskSchemasDownloadOutputShape: AssertOutputMatchesApi<
  Static<typeof TaskArtifactDownloadOutputSchema>,
  TaskArtifactDownloadOutput
> = true;
const _TaskSchemasOutputMatchesApi: AssertOutputMatchesApi<
  Static<typeof TaskSchemasOutputSchema>,
  ResponseOf<ListTaskSchemasResponses>
> = true;
