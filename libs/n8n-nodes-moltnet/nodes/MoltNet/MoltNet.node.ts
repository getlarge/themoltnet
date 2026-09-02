import {
  type Agent,
  buildTaskSnapshot,
  isTerminalTaskStatus,
  MoltNetError,
  TaskBuildError,
} from '@themoltnet/sdk';
import type {
  ICredentialsDecrypted,
  ICredentialTestFunctions,
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeCredentialTestResult,
  INodeExecutionData,
  INodeListSearchResult,
  INodeParameterResourceLocator,
  INodeType,
  INodeTypeDescription,
  JsonObject,
} from 'n8n-workflow';
import {
  NodeApiError,
  NodeConnectionTypes,
  NodeOperationError,
  sleep,
  sleepWithAbort,
} from 'n8n-workflow';

import {
  connectMoltNet,
  type MoltNetCredentials,
  optionalString,
} from '../../src/client.js';

const defaultPollIntervalSeconds = 5;
const defaultTimeoutSeconds = 1_800;
const minimumPollIntervalSeconds = 5;
const maximumPollIntervalSeconds = 60;
const maximumTimeoutSeconds = 1_800;
const taskStatuses = [
  { name: 'Waiting', value: 'waiting' },
  { name: 'Queued', value: 'queued' },
  { name: 'Dispatched', value: 'dispatched' },
  { name: 'Running', value: 'running' },
  { name: 'Completed', value: 'completed' },
  { name: 'Failed', value: 'failed' },
  { name: 'Cancelled', value: 'cancelled' },
  { name: 'Expired', value: 'expired' },
];
const taskOutputFields = [
  { name: 'Accepted Attempt Number', value: 'acceptedAttemptN' },
  { name: 'Completed At', value: 'completedAt' },
  { name: 'Correlation ID', value: 'correlationId' },
  { name: 'Diary ID', value: 'diaryId' },
  { name: 'Expires At', value: 'expiresAt' },
  { name: 'Input', value: 'input' },
  { name: 'Maximum Attempts', value: 'maxAttempts' },
  { name: 'Queued At', value: 'queuedAt' },
  { name: 'Status', value: 'status' },
  { name: 'Tags', value: 'tags' },
  { name: 'Task Type', value: 'taskType' },
  { name: 'Team ID', value: 'teamId' },
  { name: 'Title', value: 'title' },
];
const taskSnapshotOutputFields = [
  { name: 'Accepted', value: 'accepted' },
  { name: 'Accepted Attempt Number', value: 'acceptedAttemptN' },
  { name: 'Attempt', value: 'attempt' },
  { name: 'Attempts', value: 'attempts' },
  { name: 'Error', value: 'error' },
  { name: 'State', value: 'state' },
  { name: 'Status', value: 'status' },
  { name: 'Task', value: 'task' },
  { name: 'Terminal', value: 'terminal' },
];

interface CreateOptions extends IDataObject {
  title?: string;
  tags?: string;
  maxAttempts?: number;
  correlationId?: string;
  teamId?: string;
  diaryId?: string;
}

interface GetManyFilters extends IDataObject {
  correlationId?: string;
  diaryId?: string;
  query?: string;
  statuses?: string[];
  tags?: string;
  taskTypes?: string;
}

type NodeErrorContext = Pick<IExecuteFunctions, 'getNode'>;
type OutputMode = 'raw' | 'selectedFields' | 'simplified';
type TaskListQuery = NonNullable<Parameters<Agent['tasks']['list']>[0]>;
type TaskStatus = NonNullable<TaskListQuery['statuses']>[number];

function parseInput(
  context: IExecuteFunctions,
  raw: string,
  itemIndex: number,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    void error;
    throw new NodeOperationError(
      context.getNode(),
      "'Input' must contain a valid JSON object",
      {
        itemIndex,
        description: "Check the JSON syntax in 'Input' and run the node again.",
      },
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new NodeOperationError(
      context.getNode(),
      "'Input' must contain a JSON object",
      {
        itemIndex,
        description:
          'Replace the value in \'Input\' with an object, such as {"brief":"Describe the work"}.',
      },
    );
  }
  return parsed as Record<string, unknown>;
}

function toNodeError(
  context: NodeErrorContext,
  error: unknown,
  itemIndex?: number,
): NodeApiError | NodeOperationError {
  if (error instanceof NodeApiError || error instanceof NodeOperationError) {
    return error;
  }
  if (error instanceof MoltNetError) {
    const validationErrors = error.validationErrors?.map(
      ({ field, message }) => ({ field, message }) satisfies JsonObject,
    );
    const errorData: JsonObject = {
      name: error.name,
      code: error.code,
      ...(error.statusCode === undefined
        ? {}
        : { status: error.statusCode, statusCode: error.statusCode }),
      ...(error.detail === undefined ? {} : { detail: error.detail }),
      ...(validationErrors === undefined ? {} : { validationErrors }),
    };
    return new NodeApiError(
      context.getNode(),
      { response: { data: errorData } },
      {
        ...(itemIndex === undefined ? {} : { itemIndex }),
        message: apiErrorMessage(error),
        description: apiRecoveryDescription(error, validationErrors),
        ...(error.statusCode === undefined
          ? {}
          : { httpCode: String(error.statusCode) }),
      },
    );
  }
  return new NodeOperationError(
    context.getNode(),
    error instanceof Error ? error : new Error(String(error)),
    itemIndex === undefined ? {} : { itemIndex },
  );
}

function apiErrorMessage(error: MoltNetError): string {
  if (error.statusCode === 401) return 'MoltNet rejected the credential';
  if (error.statusCode === 403) return 'MoltNet denied this request';
  if (error.statusCode === 404) {
    return 'MoltNet could not find the requested task';
  }
  if (error.statusCode === 409) {
    return 'The task cannot be changed in its current status';
  }
  if (error.statusCode === 429) {
    return 'MoltNet is receiving too many requests';
  }
  if (error.statusCode !== undefined && error.statusCode >= 500) {
    return 'MoltNet could not complete the request';
  }
  return 'The MoltNet request could not be completed';
}

function apiRecoveryDescription(
  error: MoltNetError,
  validationErrors: JsonObject[] | undefined,
): string {
  const validation = validationErrors
    ?.map(({ field, message }) => `${String(field)}: ${String(message)}`)
    .join('; ');
  if (error.statusCode === 401) {
    return "Test the selected 'MoltNet API' credential and check its authentication values.";
  }
  if (error.statusCode === 403) {
    return "Check the agent key scopes and confirm that 'Team ID' selects a team the agent can access.";
  }
  if (error.statusCode === 404) {
    return "Check 'Task ID' and 'Team ID', then run the node again.";
  }
  if (error.statusCode === 409) {
    return 'Refresh the task and choose an operation allowed for its current status.';
  }
  if (error.statusCode === 429) {
    return 'Wait a moment before running the node again.';
  }
  if (error.statusCode !== undefined && error.statusCode >= 500) {
    return 'Run the node again. If the request still cannot complete, check the MoltNet service status.';
  }
  if (validation)
    return `Update these fields and run the node again: ${validation}`;
  if (error.detail)
    return `${error.detail} Check the node fields and run it again.`;
  return 'Check the node fields, credential, and team access, then run the node again.';
}

function credentialRecoveryMessage(error: unknown): string {
  if (error instanceof MoltNetError && error.statusCode === 401) {
    return 'Authentication was rejected. Check the selected authentication method and secret.';
  }
  if (error instanceof MoltNetError && error.statusCode === 403) {
    return "Authentication succeeded, but the credential cannot read the agent profile. Grant 'agent:profile' and test again.";
  }
  return "Connection could not be verified. Check 'API URL', the authentication values, and the required scopes.";
}

function requestOptions(
  teamId: string | undefined,
  signal: AbortSignal | undefined,
): { teamId?: string; signal?: AbortSignal } {
  return {
    ...(teamId ? { teamId } : {}),
    ...(signal ? { signal } : {}),
  };
}

function credentialCacheKey(credentials: MoltNetCredentials): string {
  return JSON.stringify([
    credentials.apiUrl.trim(),
    credentials.authentication ?? '',
    optionalString(credentials.agentApiKey) ?? '',
    optionalString(credentials.clientId) ?? '',
    credentials.clientSecret ?? '',
    optionalString(credentials.teamId) ?? '',
    optionalString(credentials.diaryId) ?? '',
  ]);
}

function resolveTeamId(
  override: unknown,
  credentials: MoltNetCredentials,
): string | undefined {
  return optionalString(override) ?? optionalString(credentials.teamId);
}

function requireTeamId(
  context: NodeErrorContext,
  override: unknown,
  credentials: MoltNetCredentials,
  itemIndex?: number,
): string {
  const teamId = resolveTeamId(override, credentials);
  if (teamId) return teamId;
  throw new NodeOperationError(
    context.getNode(),
    "'Team ID' is required for this operation",
    {
      ...(itemIndex === undefined ? {} : { itemIndex }),
      description:
        "Set 'Team ID' on the node or save 'Default Team ID' in the selected credential.",
    },
  );
}

function taskIdFromParameter(
  context: IExecuteFunctions,
  raw: unknown,
  itemIndex: number,
): string {
  const value =
    typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object' && 'value' in raw
        ? (raw as INodeParameterResourceLocator).value
        : undefined;
  const taskId = optionalString(value);
  if (taskId) return taskId;
  throw new NodeOperationError(context.getNode(), "'Task ID' is required", {
    itemIndex,
    description: "Select a task or enter its ID in 'Task ID'.",
  });
}

function commaSeparated(value: unknown): string[] | undefined {
  const items = optionalString(value)
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items?.length ? items : undefined;
}

function taskListQuery(
  filters: GetManyFilters,
  limit: number,
  cursor?: string,
): TaskListQuery {
  const taskTypes = commaSeparated(filters.taskTypes);
  const tags = commaSeparated(filters.tags);
  const statuses = Array.isArray(filters.statuses)
    ? (filters.statuses as TaskStatus[])
    : undefined;
  return {
    limit,
    ...(cursor ? { cursor } : {}),
    ...(optionalString(filters.query)
      ? { query: optionalString(filters.query) }
      : {}),
    ...(statuses?.length ? { statuses } : {}),
    ...(taskTypes ? { taskTypes } : {}),
    ...(tags ? { tags } : {}),
    ...(optionalString(filters.diaryId)
      ? { diaryId: optionalString(filters.diaryId) }
      : {}),
    ...(optionalString(filters.correlationId)
      ? { correlationId: optionalString(filters.correlationId) }
      : {}),
  };
}

function simplifyTask(task: IDataObject): IDataObject {
  return definedFields(task, [
    'id',
    'status',
    'taskType',
    'title',
    'teamId',
    'diaryId',
    'correlationId',
    'maxAttempts',
    'queuedAt',
    'expiresAt',
  ]);
}

function simplifyTaskSnapshot(snapshot: IDataObject): IDataObject {
  const attempt =
    snapshot.attempt &&
    typeof snapshot.attempt === 'object' &&
    !Array.isArray(snapshot.attempt)
      ? (snapshot.attempt as IDataObject)
      : undefined;
  return {
    ...definedFields(snapshot, [
      'taskId',
      'status',
      'terminal',
      'accepted',
      'acceptedAttemptN',
      'state',
      'error',
    ]),
    ...(attempt?.attemptN === undefined ? {} : { attemptN: attempt.attemptN }),
    ...(attempt?.status === undefined ? {} : { attemptStatus: attempt.status }),
    attemptCount: Array.isArray(snapshot.attempts)
      ? snapshot.attempts.length
      : 0,
  };
}

function definedFields(source: IDataObject, fields: string[]): IDataObject {
  return Object.fromEntries(
    fields.flatMap((field) =>
      source[field] === undefined ? [] : [[field, source[field]]],
    ),
  ) as IDataObject;
}

function outputMode(
  context: IExecuteFunctions,
  itemIndex: number,
): { fields: string[]; mode: OutputMode } {
  if (context.getNode().typeVersion < 2) return { fields: [], mode: 'raw' };
  if (context.isToolExecution()) {
    return {
      mode: context.getNodeParameter(
        'output',
        itemIndex,
        'simplified',
      ) as OutputMode,
      fields: context.getNodeParameter(
        'fieldsToInclude',
        itemIndex,
        [],
      ) as string[],
    };
  }
  return {
    fields: [],
    mode: context.getNodeParameter('simplify', itemIndex, true)
      ? 'simplified'
      : 'raw',
  };
}

function formatOutput(
  operation: string,
  result: IDataObject,
  configuration: { fields: string[]; mode: OutputMode },
): IDataObject {
  if (configuration.mode === 'raw') return result;
  if (configuration.mode === 'simplified') {
    return operation === 'wait'
      ? simplifyTaskSnapshot(result)
      : simplifyTask(result);
  }
  const idField = operation === 'wait' ? 'taskId' : 'id';
  return definedFields(result, [idField, ...configuration.fields]);
}

async function createTask(
  context: IExecuteFunctions,
  agent: Agent,
  credentials: MoltNetCredentials,
  itemIndex: number,
): Promise<IDataObject> {
  const taskType = context.getNodeParameter('taskType', itemIndex) as string;
  const input = parseInput(
    context,
    context.getNodeParameter('input', itemIndex) as string,
    itemIndex,
  );
  const options = context.getNodeParameter(
    'options',
    itemIndex,
    {},
  ) as CreateOptions;
  const teamId = resolveTeamId(options.teamId, credentials);
  const diaryId =
    optionalString(options.diaryId) ?? optionalString(credentials.diaryId);

  try {
    const builder = agent.tasks.buildTask(taskType.trim(), input);
    if (teamId) builder.team(teamId);
    if (diaryId) builder.diary(diaryId);
    const title = optionalString(options.title);
    if (title) builder.title(title);
    const correlationId = optionalString(options.correlationId);
    if (correlationId) builder.correlationId(correlationId);
    if (typeof options.maxAttempts === 'number') {
      builder.maxAttempts(options.maxAttempts);
    }
    const tags = optionalString(options.tags)
      ?.split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (tags?.length) builder.tags(...tags);
    return (await agent.tasks.create(builder.build())) as IDataObject;
  } catch (error) {
    if (error instanceof TaskBuildError) {
      throw new NodeOperationError(
        context.getNode(),
        'The task could not be created from the configured fields',
        {
          itemIndex,
          description: `${error.message}. Check 'Task Type', 'Input', 'Team ID', and 'Diary ID'.`,
        },
      );
    }
    throw toNodeError(context, error, itemIndex);
  }
}

async function getTask(
  context: IExecuteFunctions,
  agent: Agent,
  credentials: MoltNetCredentials,
  itemIndex: number,
): Promise<IDataObject> {
  const taskId = taskIdFromParameter(
    context,
    context.getNodeParameter('taskId', itemIndex),
    itemIndex,
  );
  const teamId = resolveTeamId(
    context.getNodeParameter('teamId', itemIndex, ''),
    credentials,
  );
  try {
    return (await agent.tasks.get(
      taskId,
      requestOptions(teamId, undefined),
    )) as IDataObject;
  } catch (error) {
    throw toNodeError(context, error, itemIndex);
  }
}

async function cancelTask(
  context: IExecuteFunctions,
  agent: Agent,
  credentials: MoltNetCredentials,
  itemIndex: number,
): Promise<IDataObject> {
  const taskId = taskIdFromParameter(
    context,
    context.getNodeParameter('taskId', itemIndex),
    itemIndex,
  );
  const teamId = resolveTeamId(
    context.getNodeParameter('teamId', itemIndex, ''),
    credentials,
  );
  const reason = optionalString(
    context.getNodeParameter('reason', itemIndex, ''),
  );
  if (!reason) {
    throw new NodeOperationError(context.getNode(), "'Reason' is required", {
      itemIndex,
      description: "Explain why the task should be cancelled in 'Reason'.",
    });
  }
  try {
    return (await agent.tasks.cancel(
      taskId,
      { reason },
      teamId ? { teamId } : undefined,
    )) as IDataObject;
  } catch (error) {
    throw toNodeError(context, error, itemIndex);
  }
}

async function getManyTasks(
  context: IExecuteFunctions,
  agent: Agent,
  credentials: MoltNetCredentials,
  itemIndex: number,
): Promise<IDataObject[]> {
  const teamId = requireTeamId(
    context,
    context.getNodeParameter('teamId', itemIndex, ''),
    credentials,
    itemIndex,
  );
  const returnAll = context.getNodeParameter(
    'returnAll',
    itemIndex,
    false,
  ) as boolean;
  const limit = returnAll
    ? 100
    : (context.getNodeParameter('limit', itemIndex, 50) as number);
  const filters = context.getNodeParameter(
    'filters',
    itemIndex,
    {},
  ) as GetManyFilters;
  const tasks: IDataObject[] = [];
  let cursor: string | undefined;

  try {
    do {
      const response = await agent.tasks.list(
        taskListQuery(filters, Math.min(limit, 100), cursor),
        { teamId },
      );
      tasks.push(...(response.items as IDataObject[]));
      cursor = returnAll ? response.nextCursor : undefined;
    } while (cursor);
    return returnAll ? tasks : tasks.slice(0, limit);
  } catch (error) {
    throw toNodeError(context, error, itemIndex);
  }
}

async function waitForTask(
  context: IExecuteFunctions,
  agent: Agent,
  credentials: MoltNetCredentials,
  itemIndex: number,
): Promise<IDataObject> {
  const taskId = taskIdFromParameter(
    context,
    context.getNodeParameter('taskId', itemIndex),
    itemIndex,
  );
  const pollIntervalSeconds = context.getNodeParameter(
    'pollInterval',
    itemIndex,
    defaultPollIntervalSeconds,
  ) as number;
  const timeoutSeconds = context.getNodeParameter(
    'timeout',
    itemIndex,
    defaultTimeoutSeconds,
  ) as number;
  if (
    !Number.isFinite(pollIntervalSeconds) ||
    pollIntervalSeconds < minimumPollIntervalSeconds
  ) {
    throw new NodeOperationError(
      context.getNode(),
      `'Polling Interval (Seconds)' must be at least ${minimumPollIntervalSeconds}`,
      {
        itemIndex,
        description: `Set 'Polling Interval (Seconds)' to ${minimumPollIntervalSeconds} or more.`,
      },
    );
  }
  if (
    !Number.isFinite(timeoutSeconds) ||
    timeoutSeconds <= 0 ||
    timeoutSeconds > maximumTimeoutSeconds
  ) {
    throw new NodeOperationError(
      context.getNode(),
      `'Timeout (Seconds)' must be between 1 and ${maximumTimeoutSeconds}`,
      {
        itemIndex,
        description: `Set 'Timeout (Seconds)' to a value from 1 through ${maximumTimeoutSeconds}.`,
      },
    );
  }
  const startedAt = Date.now();
  const deadline = startedAt + timeoutSeconds * 1_000;
  const executionSignal = context.getExecutionCancelSignal();
  const deadlineController = new AbortController();
  const deadlineSleepController = new AbortController();
  void sleepWithAbort(timeoutSeconds * 1_000, deadlineSleepController.signal)
    .then(() =>
      deadlineController.abort(new Error('MoltNet task wait timed out')),
    )
    .catch(() => undefined);
  const requestSignal = executionSignal
    ? AbortSignal.any([executionSignal, deadlineController.signal])
    : deadlineController.signal;
  const teamId = resolveTeamId(
    context.getNodeParameter('teamId', itemIndex, ''),
    credentials,
  );
  const options = requestOptions(teamId, requestSignal);
  const timeoutState: WaitTimeoutState = {
    startedAt,
    lastStatus: undefined,
    pollCount: 0,
  };

  try {
    for (;;) {
      throwIfCancelled(context, executionSignal, itemIndex);
      throwIfTimedOut(
        context,
        taskId,
        timeoutSeconds,
        deadline,
        timeoutState,
        itemIndex,
      );

      timeoutState.pollCount += 1;
      try {
        const task = await awaitWithAbort(
          agent.tasks.get(taskId, options),
          requestSignal,
        );
        throwIfCancelled(context, executionSignal, itemIndex);
        throwIfTimedOut(
          context,
          taskId,
          timeoutSeconds,
          deadline,
          timeoutState,
          itemIndex,
        );
        timeoutState.lastStatus = task.status;
        if (isTerminalTaskStatus(task.status)) {
          const attempts = await readAttemptsWithRetry(
            context,
            agent,
            taskId,
            options,
            executionSignal,
            deadlineController.signal,
            pollIntervalSeconds,
            timeoutSeconds,
            deadline,
            timeoutState,
            itemIndex,
          );
          return buildTaskSnapshot(task, attempts) as unknown as IDataObject;
        }
      } catch (error) {
        throwIfCancelled(context, executionSignal, itemIndex);
        throwIfTimedOut(
          context,
          taskId,
          timeoutSeconds,
          deadline,
          timeoutState,
          itemIndex,
          deadlineController.signal.aborted,
        );
        if (!isTransientReadError(error)) {
          throw toNodeError(context, error, itemIndex);
        }
      }

      await waitBeforeRetry(
        context,
        taskId,
        pollIntervalSeconds,
        timeoutSeconds,
        deadline,
        timeoutState,
        executionSignal,
        itemIndex,
      );
    }
  } finally {
    deadlineSleepController.abort();
  }
}

interface WaitTimeoutState {
  startedAt: number;
  lastStatus: string | undefined;
  pollCount: number;
}

async function readAttemptsWithRetry(
  context: IExecuteFunctions,
  agent: Agent,
  taskId: string,
  options: { teamId?: string; signal?: AbortSignal },
  executionSignal: AbortSignal | undefined,
  deadlineSignal: AbortSignal,
  pollIntervalSeconds: number,
  timeoutSeconds: number,
  deadline: number,
  timeoutState: WaitTimeoutState,
  itemIndex: number,
) {
  let retryCount = 0;
  for (;;) {
    throwIfCancelled(context, executionSignal, itemIndex);
    throwIfTimedOut(
      context,
      taskId,
      timeoutSeconds,
      deadline,
      timeoutState,
      itemIndex,
    );
    try {
      const attempts = await awaitWithAbort(
        agent.tasks.listAttempts(taskId, options),
        options.signal ?? deadlineSignal,
      );
      throwIfCancelled(context, executionSignal, itemIndex);
      throwIfTimedOut(
        context,
        taskId,
        timeoutSeconds,
        deadline,
        timeoutState,
        itemIndex,
      );
      return attempts;
    } catch (error) {
      throwIfCancelled(context, executionSignal, itemIndex);
      throwIfTimedOut(
        context,
        taskId,
        timeoutSeconds,
        deadline,
        timeoutState,
        itemIndex,
        deadlineSignal.aborted,
      );
      if (!isTransientReadError(error)) {
        throw toNodeError(context, error, itemIndex);
      }
    }
    retryCount += 1;
    await waitBeforeRetry(
      context,
      taskId,
      pollIntervalSeconds,
      timeoutSeconds,
      deadline,
      timeoutState,
      executionSignal,
      itemIndex,
      retryCount,
    );
  }
}

async function waitBeforeRetry(
  context: IExecuteFunctions,
  taskId: string,
  pollIntervalSeconds: number,
  timeoutSeconds: number,
  deadline: number,
  timeoutState: WaitTimeoutState,
  signal: AbortSignal | undefined,
  itemIndex: number,
  retryCount = timeoutState.pollCount - 1,
): Promise<void> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw waitTimeoutError(
      context,
      taskId,
      timeoutSeconds,
      timeoutState,
      itemIndex,
    );
  }
  const delayMs = pollingDelayMs(pollIntervalSeconds, retryCount);
  await cancellableSleep(
    context,
    Math.min(delayMs, remainingMs),
    signal,
    itemIndex,
  );
}

function pollingDelayMs(
  pollIntervalSeconds: number,
  retryCount: number,
): number {
  const minimumMs = minimumPollIntervalSeconds * 1_000;
  const maximumMs = maximumPollIntervalSeconds * 1_000;
  const cappedMs = Math.min(
    maximumMs,
    pollIntervalSeconds * 1_000 * 2 ** Math.min(retryCount, 10),
  );
  const lowerBoundMs = Math.max(minimumMs, cappedMs * 0.8);
  const upperBoundMs = Math.min(maximumMs, cappedMs * 1.2);
  return Math.round(
    lowerBoundMs + Math.random() * (upperBoundMs - lowerBoundMs),
  );
}

function isTransientReadError(error: unknown): boolean {
  return (
    error instanceof MoltNetError &&
    (error.code === 'NETWORK_ERROR' ||
      error.statusCode === 429 ||
      (error.statusCode !== undefined && error.statusCode >= 500))
  );
}

function throwIfTimedOut(
  context: IExecuteFunctions,
  taskId: string,
  timeoutSeconds: number,
  deadline: number,
  timeoutState: WaitTimeoutState,
  itemIndex: number,
  deadlineAborted = false,
): void {
  if (!deadlineAborted && Date.now() < deadline) return;
  throw waitTimeoutError(
    context,
    taskId,
    timeoutSeconds,
    timeoutState,
    itemIndex,
  );
}

function throwIfCancelled(
  context: IExecuteFunctions,
  signal: AbortSignal | undefined,
  itemIndex: number,
): void {
  if (!signal?.aborted) return;
  throw new NodeOperationError(context.getNode(), 'Execution was cancelled', {
    itemIndex,
  });
}

function awaitWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error('Operation aborted'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(signal.reason ?? new Error('Operation aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    void operation.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

async function cancellableSleep(
  context: IExecuteFunctions,
  durationMs: number,
  signal: AbortSignal | undefined,
  itemIndex: number,
): Promise<void> {
  throwIfCancelled(context, signal, itemIndex);
  if (!signal) {
    await sleep(durationMs);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      reject(
        new NodeOperationError(context.getNode(), 'Execution was cancelled', {
          itemIndex,
        }),
      );
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void sleep(durationMs)
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener('abort', onAbort);
      });
  });
}

function waitTimeoutError(
  context: IExecuteFunctions,
  taskId: string,
  timeoutSeconds: number,
  state: WaitTimeoutState,
  itemIndex: number,
): NodeOperationError {
  const elapsedSeconds = Math.max(0, Date.now() - state.startedAt) / 1_000;
  return new NodeOperationError(
    context.getNode(),
    `Task ${taskId} did not finish within ${elapsedSeconds.toFixed(1)} seconds`,
    {
      itemIndex,
      description: `Increase 'Timeout (Seconds)' or run Wait again. Configured timeout: ${timeoutSeconds} seconds; checks: ${state.pollCount}; last status: ${state.lastStatus ?? 'unknown'}.`,
    },
  );
}

function continueOnFailData(error: unknown, nodeError: Error): IDataObject {
  if (error instanceof NodeApiError) {
    const data = error.context.data;
    return data && typeof data === 'object' && !Array.isArray(data)
      ? { error: nodeError.message, ...(data as IDataObject) }
      : { error: nodeError.message };
  }
  if (!(error instanceof MoltNetError)) return { error: nodeError.message };
  return {
    error: nodeError.message,
    code: error.code,
    ...(error.statusCode === undefined ? {} : { statusCode: error.statusCode }),
    ...(error.detail === undefined ? {} : { detail: error.detail }),
    ...(error.validationErrors === undefined
      ? {}
      : {
          validationErrors: error.validationErrors.map(
            ({ field, message }) => ({
              field,
              message,
            }),
          ),
        }),
  };
}

export class MoltNet implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'MoltNet',
    name: 'moltNet',
    icon: {
      light: 'file:moltnet-mark.svg',
      dark: 'file:moltnet-mark.dark.svg',
    },
    // n8n's closest supported palette color to MoltNet network teal.
    iconColor: 'azure',
    group: ['transform'],
    version: [1, 2],
    defaultVersion: 2,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Create, find, inspect, cancel, and wait for MoltNet tasks',
    defaults: { name: 'MoltNet' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [
      {
        name: 'moltNetApi',
        required: true,
        testedBy: 'moltNetApiCredentialTest',
      },
    ],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [{ name: 'Task', value: 'task' }],
        default: 'task',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['task'] } },
        options: [
          {
            name: 'Cancel',
            value: 'cancel',
            action: 'Cancel task',
            description: 'Stop a task that has not finished',
          },
          {
            name: 'Create',
            value: 'create',
            action: 'Create task',
            description: 'Create a validated MoltNet task',
          },
          {
            name: 'Get',
            value: 'get',
            action: 'Get task',
            description: 'Retrieve one MoltNet task',
          },
          {
            name: 'Get Many',
            value: 'getMany',
            action: 'Get many tasks',
            description: 'Retrieve a filtered list of MoltNet tasks',
          },
          {
            name: 'Wait',
            value: 'wait',
            action: 'Wait for task',
            description: 'Check a task until it finishes or expires',
          },
        ],
        default: 'create',
      },
      {
        displayName: 'Task Type',
        name: 'taskType',
        type: 'string',
        default: 'freeform',
        required: true,
        displayOptions: { show: { operation: ['create'], resource: ['task'] } },
        description: 'Task type supported by the agent that will do the work',
      },
      {
        displayName: 'Input',
        name: 'input',
        type: 'json',
        default: '{\n  "brief": "Describe the work"\n}',
        required: true,
        displayOptions: { show: { operation: ['create'], resource: ['task'] } },
        description: 'JSON details sent to the agent doing the work',
      },
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: { show: { operation: ['create'], resource: ['task'] } },
        options: [
          {
            displayName: 'Correlation ID',
            name: 'correlationId',
            type: 'string',
            default: '',
            placeholder: 'e.g. 55555555-5555-4555-8555-555555555555',
          },
          {
            displayName: 'Diary ID',
            name: 'diaryId',
            type: 'string',
            default: '',
            placeholder: 'e.g. 22222222-2222-4222-8222-222222222222',
            description: 'Overrides the diary stored in the credential',
          },
          {
            displayName: 'Maximum Attempts',
            name: 'maxAttempts',
            type: 'number',
            typeOptions: { minValue: 1 },
            default: 1,
          },
          {
            displayName: 'Tags',
            name: 'tags',
            type: 'string',
            default: '',
            placeholder: 'e.g. review,highPriority',
            description: 'Comma-separated task tags',
          },
          {
            displayName: 'Team ID',
            name: 'teamId',
            type: 'string',
            default: '',
            placeholder: 'e.g. 11111111-1111-4111-8111-111111111111',
            description: 'Overrides the team stored in the credential',
          },
          {
            displayName: 'Title',
            name: 'title',
            type: 'string',
            default: '',
            placeholder: 'e.g. Review pull request',
          },
        ],
      },
      {
        displayName: 'Task ID',
        name: 'taskId',
        type: 'string',
        default: '={{$json.id}}',
        required: true,
        displayOptions: {
          show: {
            '@version': [1],
            operation: ['cancel', 'get', 'wait'],
            resource: ['task'],
          },
        },
        description: 'ID of the task to use',
      },
      {
        displayName: 'Task ID',
        name: 'taskId',
        type: 'resourceLocator',
        default: { mode: 'list', value: '' },
        required: true,
        displayOptions: {
          show: {
            '@version': [2],
            operation: ['cancel', 'get', 'wait'],
            resource: ['task'],
          },
        },
        modes: [
          {
            displayName: 'From List',
            name: 'list',
            type: 'list',
            placeholder: 'Select a task...',
            typeOptions: {
              searchListMethod: 'searchTasks',
              searchable: true,
              slowLoadNotice: {
                message:
                  "If loading takes too long, select 'By ID' and enter the task ID.",
                timeout: 10_000,
              },
            },
          },
          {
            displayName: 'By ID',
            name: 'id',
            type: 'string',
            placeholder: 'e.g. 33333333-3333-4333-8333-333333333333',
          },
        ],
      },
      {
        displayName: 'Reason',
        name: 'reason',
        type: 'string',
        default: 'Cancelled by n8n workflow',
        required: true,
        displayOptions: {
          show: { operation: ['cancel'], resource: ['task'] },
        },
        placeholder: 'e.g. Request is no longer needed',
        description: 'Reason recorded with the cancelled task',
      },
      {
        displayName: 'Team ID',
        name: 'teamId',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            operation: ['cancel', 'get', 'getMany', 'wait'],
            resource: ['task'],
          },
        },
        placeholder: 'e.g. 11111111-1111-4111-8111-111111111111',
        description:
          'Team to use instead of the default saved in the credential',
      },
      {
        displayName: 'Return All',
        name: 'returnAll',
        type: 'boolean',
        default: false,
        displayOptions: {
          show: { operation: ['getMany'], resource: ['task'] },
        },
        description:
          'Whether to return all results or only up to a given limit',
      },
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: 100 },
        default: 50,
        displayOptions: {
          show: {
            operation: ['getMany'],
            resource: ['task'],
            returnAll: [false],
          },
        },
        description: 'Max number of results to return',
      },
      {
        displayName: 'Filters',
        name: 'filters',
        type: 'collection',
        placeholder: 'Add Filter',
        default: {},
        displayOptions: {
          show: { operation: ['getMany'], resource: ['task'] },
        },
        options: [
          {
            displayName: 'Correlation ID',
            name: 'correlationId',
            type: 'string',
            default: '',
            placeholder: 'e.g. 55555555-5555-4555-8555-555555555555',
          },
          {
            displayName: 'Diary ID',
            name: 'diaryId',
            type: 'string',
            default: '',
            placeholder: 'e.g. 22222222-2222-4222-8222-222222222222',
          },
          {
            displayName: 'Query',
            name: 'query',
            type: 'string',
            default: '',
            placeholder: 'e.g. review',
            description: 'Text to find in task titles, types, or input',
          },
          {
            displayName: 'Statuses',
            name: 'statuses',
            type: 'multiOptions',
            default: [],
            options: taskStatuses,
            description: 'Statuses to include',
          },
          {
            displayName: 'Tags',
            name: 'tags',
            type: 'string',
            default: '',
            placeholder: 'e.g. review,highPriority',
            description: 'Comma-separated tags that every task must have',
          },
          {
            displayName: 'Task Types',
            name: 'taskTypes',
            type: 'string',
            default: '',
            placeholder: 'e.g. freeform,fulfillBrief',
            description: 'Comma-separated task types to include',
          },
        ],
      },
      {
        displayName: 'Polling Interval (Seconds)',
        name: 'pollInterval',
        type: 'number',
        typeOptions: { minValue: minimumPollIntervalSeconds },
        default: defaultPollIntervalSeconds,
        displayOptions: { show: { operation: ['wait'], resource: ['task'] } },
      },
      {
        displayName: 'Timeout (Seconds)',
        name: 'timeout',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: maximumTimeoutSeconds },
        default: defaultTimeoutSeconds,
        displayOptions: { show: { operation: ['wait'], resource: ['task'] } },
        description:
          "Maximum wait for this run; check longer tasks by running 'Wait' again",
      },
      {
        displayName: 'Simplify',
        name: 'simplify',
        type: 'boolean',
        default: true,
        displayOptions: {
          show: {
            '@tool': [false],
            '@version': [2],
            operation: ['cancel', 'create', 'get', 'getMany', 'wait'],
            resource: ['task'],
          },
        },
        description:
          'Whether to return a simplified version of the response instead of the raw data',
      },
      {
        displayName: 'Output',
        name: 'output',
        type: 'options',
        default: 'simplified',
        displayOptions: {
          show: {
            '@tool': [true],
            '@version': [2],
            operation: ['cancel', 'create', 'get', 'getMany', 'wait'],
            resource: ['task'],
          },
        },
        options: [
          {
            name: 'Raw',
            value: 'raw',
            description: 'Return every available field',
          },
          {
            name: 'Selected Fields',
            value: 'selectedFields',
            description: 'Return the task ID and selected fields',
          },
          {
            name: 'Simplified',
            value: 'simplified',
            description: 'Return up to 10 useful fields',
          },
        ],
      },
      {
        displayName: 'Fields to Include',
        name: 'fieldsToInclude',
        type: 'multiOptions',
        default: [],
        displayOptions: {
          show: {
            '@tool': [true],
            '@version': [2],
            operation: ['cancel', 'create', 'get', 'getMany'],
            output: ['selectedFields'],
            resource: ['task'],
          },
        },
        options: taskOutputFields,
        description: 'Fields to include in addition to the task ID',
      },
      {
        displayName: 'Fields to Include',
        name: 'fieldsToInclude',
        type: 'multiOptions',
        default: [],
        displayOptions: {
          show: {
            '@tool': [true],
            '@version': [2],
            operation: ['wait'],
            output: ['selectedFields'],
            resource: ['task'],
          },
        },
        options: taskSnapshotOutputFields,
        description: 'Fields to include in addition to the task ID',
      },
    ],
  };

  methods = {
    listSearch: {
      async searchTasks(
        this: ILoadOptionsFunctions,
        filter?: string,
        paginationToken?: string,
      ): Promise<INodeListSearchResult> {
        const credentials =
          await this.getCredentials<MoltNetCredentials>('moltNetApi');
        const teamId = requireTeamId(
          this,
          this.getCurrentNodeParameter('teamId'),
          credentials,
        );
        try {
          const agent = await connectMoltNet(credentials);
          const response = await agent.tasks.list(
            {
              limit: 50,
              ...(optionalString(filter)
                ? { query: optionalString(filter) }
                : {}),
              ...(optionalString(paginationToken)
                ? { cursor: optionalString(paginationToken) }
                : {}),
            },
            { teamId },
          );
          return {
            results: response.items.map((task) => ({
              name: `${task.title ?? task.taskType} (${task.status})`,
              value: task.id,
            })),
            ...(response.nextCursor
              ? { paginationToken: response.nextCursor }
              : {}),
          };
        } catch (error) {
          throw toNodeError(this, error);
        }
      },
    },
    credentialTest: {
      async moltNetApiCredentialTest(
        this: ICredentialTestFunctions,
        credential: ICredentialsDecrypted,
      ): Promise<INodeCredentialTestResult> {
        void this;
        try {
          const agent = await connectMoltNet(
            credential.data as MoltNetCredentials,
          );
          await agent.agents.whoami();
          return { status: 'OK', message: 'Authentication successful' };
        } catch (error) {
          return {
            status: 'Error',
            message: credentialRecoveryMessage(error),
          };
        }
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const inputItems = this.getInputData();
    const outputItems: INodeExecutionData[] = [];
    const connections = new Map<string, Promise<Agent>>();
    const executionSignal = this.getExecutionCancelSignal();

    for (let itemIndex = 0; itemIndex < inputItems.length; itemIndex += 1) {
      try {
        throwIfCancelled(this, executionSignal, itemIndex);
        const operation = this.getNodeParameter(
          'operation',
          itemIndex,
        ) as string;
        const credentials = await this.getCredentials<MoltNetCredentials>(
          'moltNetApi',
          itemIndex,
        );
        const cacheKey = credentialCacheKey(credentials);
        let connection = connections.get(cacheKey);
        if (!connection) {
          connection = connectMoltNet(credentials);
          connections.set(cacheKey, connection);
        }
        const agent = await connection;
        let results: IDataObject[];
        switch (operation) {
          case 'cancel':
            results = [await cancelTask(this, agent, credentials, itemIndex)];
            break;
          case 'create':
            results = [await createTask(this, agent, credentials, itemIndex)];
            break;
          case 'get':
            results = [await getTask(this, agent, credentials, itemIndex)];
            break;
          case 'getMany':
            results = await getManyTasks(this, agent, credentials, itemIndex);
            break;
          case 'wait':
            results = [await waitForTask(this, agent, credentials, itemIndex)];
            break;
          default:
            throw new NodeOperationError(
              this.getNode(),
              "'Operation' is not supported",
              {
                itemIndex,
                description: "Select a supported value in 'Operation'.",
              },
            );
        }
        const configuration = outputMode(this, itemIndex);
        outputItems.push(
          ...results.map((result) => ({
            json: formatOutput(operation, result, configuration),
            pairedItem: { item: itemIndex },
          })),
        );
      } catch (error) {
        const nodeError = toNodeError(this, error, itemIndex);
        if (executionSignal?.aborted) throw nodeError;
        if (!this.continueOnFail()) throw nodeError;
        outputItems.push({
          json: continueOnFailData(error, nodeError),
          error: nodeError,
          pairedItem: { item: itemIndex },
        });
      }
    }

    return [outputItems];
  }
}
