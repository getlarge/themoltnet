import type {
  CreateTaskData,
  StageTaskArtifactData,
  Task,
} from '@moltnet/api-client';
import {
  abortTaskAttempt,
  appendTaskMessages,
  batchDeleteTasks,
  cancelTask,
  claimTask,
  completeTask,
  createTask,
  failTaskAttempt,
  getTask,
  listTaskArtifacts,
  listTaskAttempts,
  listTaskMessages,
  listTasks,
  listTaskSchemas,
  registerExecutorManifest,
  stageTaskArtifact,
  taskHeartbeat,
  uploadTaskArtifact,
  type UploadTaskArtifactData,
} from '@moltnet/api-client';

import type { TaskRequestOptions, TasksNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';
import { MoltNetError } from '../errors.js';
import type { BuiltTask } from '../tasks/index.js';
import {
  buildAssessBrief,
  buildCuratePack,
  buildFreeform,
  buildFulfillBrief,
  buildJudgeEvalAttempt,
  buildJudgeEvalAttemptForRunEval,
  buildJudgePack,
  buildPrReview,
  buildRenderPack,
  buildRunEval,
  buildTask,
  createResultReader,
  TaskResultError,
} from '../tasks/index.js';
import { requiredTeamHeaders } from './team-headers.js';

type TaskArtifactUploadOptions = Parameters<typeof uploadTaskArtifact>[0] & {
  duplex: 'half';
};

type TaskArtifactStageOptions = Parameters<typeof stageTaskArtifact>[0] & {
  duplex: 'half';
};

const MAX_REMEMBERED_TASK_TEAMS = 1000;

export function createTasksNamespace(context: AgentContext): TasksNamespace {
  const { client, auth } = context;
  const taskTeams = new Map<string, string>();

  const rememberTask = <T extends Task>(task: T): T => {
    taskTeams.delete(task.id);
    taskTeams.set(task.id, task.teamId);
    if (taskTeams.size > MAX_REMEMBERED_TASK_TEAMS) {
      const oldestTaskId = taskTeams.keys().next().value;
      if (oldestTaskId !== undefined) taskTeams.delete(oldestTaskId);
    }
    return task;
  };
  const headersForTask = (
    taskId: string,
    options?: TaskRequestOptions,
  ): ReturnType<typeof requiredTeamHeaders> | undefined => {
    const teamId = options?.teamId ?? taskTeams.get(taskId);
    return teamId ? requiredTeamHeaders({ teamId }) : undefined;
  };

  return {
    async schemas() {
      return unwrapResult(await listTaskSchemas({ client, auth }));
    },

    async registerExecutorManifest(body) {
      return unwrapResult(
        await registerExecutorManifest({ client, auth, body }),
      );
    },

    artifacts: {
      async stage(body, query, options) {
        const stageOptions = {
          auth,
          body: body as unknown as NonNullable<StageTaskArtifactData['body']>,
          client,
          duplex: 'half',
          headers: {
            ...requiredTeamHeaders(options),
            'content-type': 'application/octet-stream',
          },
          query,
        } satisfies TaskArtifactStageOptions;

        return {
          ...unwrapResult(await stageTaskArtifact(stageOptions)),
          artifactSource: 'staged',
        };
      },

      async upload(path, body, query, options) {
        const uploadOptions = {
          auth,
          body: body as unknown as NonNullable<UploadTaskArtifactData['body']>,
          client,
          duplex: 'half',
          headers: {
            ...requiredTeamHeaders(options),
            'content-type': 'application/octet-stream',
          },
          path,
          query,
        } satisfies TaskArtifactUploadOptions;

        return unwrapResult(await uploadTaskArtifact(uploadOptions));
      },

      async list(taskId, options, query) {
        const response = unwrapResult(
          await listTaskArtifacts({
            client,
            auth,
            headers: requiredTeamHeaders(options),
            path: { taskId },
            query,
          }),
        );
        return response.artifacts;
      },

      async listPage(taskId, query, options) {
        return unwrapResult(
          await listTaskArtifacts({
            client,
            auth,
            headers: requiredTeamHeaders(options),
            path: { taskId },
            query,
          }),
        );
      },

      async download(path, options) {
        const request = {
          auth,
          headers: requiredTeamHeaders(options),
          method: 'GET' as const,
          parseAs: 'stream' as const,
          security: [{ scheme: 'bearer' as const, type: 'http' as const }],
        };
        const result =
          'attemptN' in path
            ? await client.request({
                ...request,
                path,
                url: '/tasks/{taskId}/attempts/{attemptN}/artifacts/{cid}/content',
              })
            : await client.request({
                ...request,
                path,
                url: '/tasks/{taskId}/artifacts/{cid}/content',
              });
        const stream = unwrapResult(result);
        const normalizedStream = normalizeDownloadStream(stream);
        if (normalizedStream) {
          return {
            artifactId: header(result.response, 'x-moltnet-task-artifact-id'),
            cid: header(result.response, 'x-moltnet-task-artifact-cid'),
            contentEncoding: header(
              result.response,
              'x-moltnet-task-artifact-content-encoding',
            ),
            contentType: header(
              result.response,
              'x-moltnet-task-artifact-content-type',
            ),
            stream: normalizedStream,
          };
        }
        throw new MoltNetError(
          'Unexpected task artifact download response stream',
          { code: 'INVALID_RESPONSE' },
        );
      },
    },

    async list(query, options) {
      const response = unwrapResult(
        await listTasks({
          client,
          auth,
          query,
          headers: requiredTeamHeaders(options),
        }),
      );
      response.items.forEach(rememberTask);
      return response;
    },

    async create(
      bodyOrBuilt: CreateTaskData['body'] | BuiltTask,
      options?: TaskRequestOptions,
    ) {
      // Accept either a raw (body, { teamId }) pair or a builder's
      // { body, teamId } result.
      const { body, teamId, idempotencyKey } =
        options !== undefined
          ? {
              body: bodyOrBuilt as CreateTaskData['body'],
              teamId: options.teamId,
              idempotencyKey: options.idempotencyKey,
            }
          : { ...(bodyOrBuilt as BuiltTask), idempotencyKey: undefined };
      return rememberTask(
        unwrapResult(
          await createTask({
            client,
            auth,
            body,
            headers: {
              ...requiredTeamHeaders({ teamId }),
              ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
            },
          }),
        ),
      );
    },

    buildTask,
    buildFreeform,
    buildFulfillBrief,
    buildCuratePack,
    buildRenderPack,
    buildRunEval,
    buildAssessBrief,
    buildJudgePack,
    buildJudgeEvalAttempt,
    buildJudgeEvalAttemptForRunEval,
    buildPrReview,

    async readResult(taskOrId: string | Task, options?: TaskRequestOptions) {
      const task =
        typeof taskOrId === 'string'
          ? rememberTask(
              unwrapResult(
                await getTask({
                  client,
                  auth,
                  headers: headersForTask(taskOrId, options),
                  path: { id: taskOrId },
                }),
              ),
            )
          : rememberTask(taskOrId);
      if (
        task.acceptedAttemptN === null ||
        task.acceptedAttemptN === undefined
      ) {
        throw new TaskResultError([
          {
            field: 'acceptedAttemptN',
            message: 'task has no accepted attempt',
          },
        ]);
      }
      const attempts = unwrapResult(
        await listTaskAttempts({
          client,
          auth,
          headers: headersForTask(task.id, options),
          path: { id: task.id },
        }),
      );
      const accepted = attempts.find(
        (a) => a.attemptN === task.acceptedAttemptN,
      );
      if (!accepted) {
        throw new TaskResultError([
          {
            field: 'acceptedAttemptN',
            message: 'no accepted attempt found for task',
          },
        ]);
      }
      return createResultReader(task, accepted);
    },

    async get(id, options) {
      return rememberTask(
        unwrapResult(
          await getTask({
            client,
            auth,
            headers: headersForTask(id, options),
            path: { id },
          }),
        ),
      );
    },

    async claim(id, body, options) {
      const result = await claimTask({
        client,
        auth,
        headers: headersForTask(id, options),
        path: { id },
        body,
      });
      const data = unwrapResult(result);
      rememberTask(data.task);
      const traceHeaders: Record<string, string> = {};
      const traceparent = result.response.headers.get('traceparent');
      if (traceparent) {
        traceHeaders['traceparent'] = traceparent;
        const tracestate = result.response.headers.get('tracestate');
        if (tracestate) traceHeaders['tracestate'] = tracestate;
      }
      return { ...data, traceHeaders };
    },

    async heartbeat(id, n, body, options) {
      return unwrapResult(
        await taskHeartbeat({
          client,
          auth,
          headers: headersForTask(id, options),
          path: { id, n },
          body,
        }),
      );
    },

    async complete(id, n, body, options) {
      return rememberTask(
        unwrapResult(
          await completeTask({
            client,
            auth,
            headers: headersForTask(id, options),
            path: { id, n },
            body,
          }),
        ),
      );
    },

    async failAttempt(id, n, body, options) {
      return rememberTask(
        unwrapResult(
          await failTaskAttempt({
            client,
            auth,
            headers: headersForTask(id, options),
            path: { id, n },
            body,
          }),
        ),
      );
    },

    async abortAttempt(id, n, body, options) {
      return rememberTask(
        unwrapResult(
          await abortTaskAttempt({
            client,
            auth,
            headers: headersForTask(id, options),
            path: { id, n },
            body,
          }),
        ),
      );
    },

    async cancel(id, body, options) {
      return rememberTask(
        unwrapResult(
          await cancelTask({
            client,
            auth,
            headers: headersForTask(id, options),
            path: { id },
            body,
          }),
        ),
      );
    },

    async deleteMany(body, options) {
      return unwrapResult(
        await batchDeleteTasks({
          client,
          auth,
          headers: options ? requiredTeamHeaders(options) : undefined,
          body,
        }),
      );
    },

    async listAttempts(id, options) {
      return unwrapResult(
        await listTaskAttempts({
          client,
          auth,
          headers: headersForTask(id, options),
          path: { id },
        }),
      );
    },

    async listMessages(id, n, query, options) {
      return unwrapResult(
        await listTaskMessages({
          client,
          auth,
          headers: headersForTask(id, options),
          path: { id, n },
          query,
        }),
      );
    },

    async appendMessages(id, n, body, options) {
      return unwrapResult(
        await appendTaskMessages({
          client,
          auth,
          headers: headersForTask(id, options),
          path: { id, n },
          body,
        }),
      );
    },
  };
}

function header(response: Response | undefined, name: string): string | null {
  const value = response?.headers.get(name) ?? null;
  return value === '' ? null : value;
}

function normalizeDownloadStream(
  stream: unknown,
): AsyncIterable<Uint8Array> | null {
  if (isAsyncIterable(stream)) {
    return stream;
  }
  if (isReadableStream(stream)) {
    return readableStreamToAsyncIterable(stream);
  }
  return null;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === 'function'
  );
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getReader' in value &&
    typeof value.getReader === 'function'
  );
}

async function* readableStreamToAsyncIterable(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        return;
      }
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}
