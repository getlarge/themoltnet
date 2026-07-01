import type { CreateTaskData, Task } from '@moltnet/api-client';
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

export function createTasksNamespace(context: AgentContext): TasksNamespace {
  const { client, auth } = context;

  return {
    async schemas() {
      return unwrapResult(await listTaskSchemas({ client, auth }));
    },

    artifacts: {
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
        const result = await client.request({
          auth,
          headers: requiredTeamHeaders(options),
          method: 'GET',
          parseAs: 'stream',
          path,
          security: [{ scheme: 'bearer', type: 'http' }],
          url: '/tasks/{taskId}/attempts/{attemptN}/artifacts/{cid}/content',
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
      return unwrapResult(
        await listTasks({
          client,
          auth,
          query,
          headers: requiredTeamHeaders(options),
        }),
      );
    },

    async create(
      bodyOrBuilt: CreateTaskData['body'] | BuiltTask,
      options?: TaskRequestOptions,
    ) {
      // Accept either a raw (body, { teamId }) pair or a builder's
      // { body, teamId } result.
      const { body, teamId } =
        options !== undefined
          ? {
              body: bodyOrBuilt as CreateTaskData['body'],
              teamId: options.teamId,
            }
          : (bodyOrBuilt as BuiltTask);
      return unwrapResult(
        await createTask({
          client,
          auth,
          body,
          headers: requiredTeamHeaders({ teamId }),
        }),
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

    async readResult(taskOrId: string | Task) {
      const task =
        typeof taskOrId === 'string'
          ? unwrapResult(
              await getTask({ client, auth, path: { id: taskOrId } }),
            )
          : taskOrId;
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
        await listTaskAttempts({ client, auth, path: { id: task.id } }),
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

    async get(id) {
      return unwrapResult(await getTask({ client, auth, path: { id } }));
    },

    async claim(id, body) {
      const result = await claimTask({ client, auth, path: { id }, body });
      const data = unwrapResult(result);
      const traceHeaders: Record<string, string> = {};
      const traceparent = result.response.headers.get('traceparent');
      if (traceparent) {
        traceHeaders['traceparent'] = traceparent;
        const tracestate = result.response.headers.get('tracestate');
        if (tracestate) traceHeaders['tracestate'] = tracestate;
      }
      return { ...data, traceHeaders };
    },

    async heartbeat(id, n, body) {
      return unwrapResult(
        await taskHeartbeat({ client, auth, path: { id, n }, body }),
      );
    },

    async complete(id, n, body) {
      return unwrapResult(
        await completeTask({ client, auth, path: { id, n }, body }),
      );
    },

    async failAttempt(id, n, body) {
      return unwrapResult(
        await failTaskAttempt({ client, auth, path: { id, n }, body }),
      );
    },

    async abortAttempt(id, n, body) {
      return unwrapResult(
        await abortTaskAttempt({ client, auth, path: { id, n }, body }),
      );
    },

    async cancel(id, body) {
      return unwrapResult(
        await cancelTask({ client, auth, path: { id }, body }),
      );
    },

    async deleteMany(body) {
      return unwrapResult(await batchDeleteTasks({ client, auth, body }));
    },

    async listAttempts(id) {
      return unwrapResult(
        await listTaskAttempts({ client, auth, path: { id } }),
      );
    },

    async listMessages(id, n, query) {
      return unwrapResult(
        await listTaskMessages({ client, auth, path: { id, n }, query }),
      );
    },

    async appendMessages(id, n, body) {
      return unwrapResult(
        await appendTaskMessages({ client, auth, path: { id, n }, body }),
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
