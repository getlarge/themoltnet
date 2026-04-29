/**
 * Task MCP tool schemas.
 *
 * Inputs use snake_case for MCP ergonomics and are mapped to the camelCase
 * REST API client shapes in task-tools.ts.
 */

import type {
  CreateTaskData,
  CreateTaskResponses,
  GetTaskData,
  GetTaskResponses,
  ListTaskAttemptsData,
  ListTaskAttemptsResponses,
  ListTaskMessagesData,
  ListTaskMessagesResponses,
  ListTaskSchemasResponses,
  ListTasksResponses,
} from '@moltnet/api-client';
import {
  ExecutorTrustLevel,
  Task,
  TaskAttempt,
  TaskMessage,
  TaskRef,
  TaskStatus,
} from '@moltnet/tasks';
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

import type {
  AssertOutputMatchesApi,
  AssertSchemaToApi,
  BodyOf,
  PathOf,
  QueryOf,
  ResponseOf,
} from './common.js';

export const TasksSchemasInputSchema = Type.Object({});
export type TasksSchemasInput = {};

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
    description: 'Diary ID the task is imposed against.',
  }),
  input: Type.Record(Type.String(), Type.Unknown(), {
    description: 'Task-type-specific input payload.',
  }),
  references: Type.Optional(
    Type.Array(TaskRef, {
      description: 'References to prior tasks or external artifacts.',
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
  criteria_cid: Type.Optional(
    Type.String({
      minLength: 1,
      description: 'Optional criteria CID for judgment task types.',
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
  team_id: CreateTaskBody['teamId'];
  diary_id: CreateTaskBody['diaryId'];
  input: CreateTaskBody['input'];
  references?: CreateTaskBody['references'];
  correlation_id?: CreateTaskBody['correlationId'];
  max_attempts?: CreateTaskBody['maxAttempts'];
  expires_in_sec?: CreateTaskBody['expiresInSec'];
  criteria_cid?: CreateTaskBody['criteriaCid'];
  required_executor_trust_level?: CreateTaskBody['requiredExecutorTrustLevel'];
  dispatch_timeout_sec?: CreateTaskBody['dispatchTimeoutSec'];
  running_timeout_sec?: CreateTaskBody['runningTimeoutSec'];
};
type _TaskCreateInputMatchesApi = AssertSchemaToApi<
  Static<typeof TaskCreateSchema>,
  TaskCreateInput
>;

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
  status: Type.Optional(TaskStatus),
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
  imposed_by_agent_id: Type.Optional(
    Type.String({
      format: 'uuid',
      description: 'Optional requester agent ID filter.',
    }),
  ),
  imposed_by_human_id: Type.Optional(
    Type.String({
      format: 'uuid',
      description: 'Optional requester human ID filter.',
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
  { additionalProperties: false },
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

export const TaskConsoleLinkOutputSchema = Type.Object({
  id: Type.String(),
  consoleUrl: Type.Optional(Type.String()),
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
  status: Type.Optional(TaskStatus),
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
  imposed_by_agent_id: Type.Optional(
    Type.String({
      format: 'uuid',
      description:
        'Optional requester agent ID filter used to pre-load the queue.',
    }),
  ),
  imposed_by_human_id: Type.Optional(
    Type.String({
      format: 'uuid',
      description:
        'Optional requester human ID filter used to pre-load the queue.',
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
  status: Type.Optional(TaskStatus),
  filters: Type.Optional(Type.Partial(TaskListSchema)),
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
type _TaskCreateOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof TaskOutputSchema>,
  TaskWithConsoleUrl
>;
type _TaskGetOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof TaskOutputSchema>,
  ResponseOf<GetTaskResponses> & { consoleUrl?: string }
>;
type _TaskListOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof TaskListOutputSchema>,
  Omit<ResponseOf<ListTasksResponses>, 'items'> & {
    items: TaskWithConsoleUrl[];
  }
>;
type _TaskAttemptsOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof TaskAttemptsListOutputSchema>,
  { items: ResponseOf<ListTaskAttemptsResponses> }
>;
type _TaskMessagesOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof TaskMessagesListOutputSchema>,
  { items: ResponseOf<ListTaskMessagesResponses> }
>;
type _TaskSchemasOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof TaskSchemasOutputSchema>,
  ResponseOf<ListTaskSchemasResponses>
>;
