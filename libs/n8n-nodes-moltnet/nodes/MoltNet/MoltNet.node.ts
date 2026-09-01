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
  INodeCredentialTestResult,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  JsonObject,
} from 'n8n-workflow';
import {
  NodeApiError,
  NodeConnectionTypes,
  NodeOperationError,
  sleep,
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

interface CreateOptions extends IDataObject {
  title?: string;
  tags?: string;
  maxAttempts?: number;
  correlationId?: string;
  teamId?: string;
  diaryId?: string;
}

function parseInput(
  context: IExecuteFunctions,
  raw: string,
  itemIndex: number,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new NodeOperationError(context.getNode(), error as Error, {
      itemIndex,
      description: 'Enter a valid JSON object for the task input.',
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new NodeOperationError(
      context.getNode(),
      'Input must be a JSON object',
      {
        itemIndex,
        description: 'Enter a valid JSON object for the task input.',
      },
    );
  }
  return parsed as Record<string, unknown>;
}

function toNodeError(
  context: IExecuteFunctions,
  error: unknown,
  itemIndex: number,
): NodeApiError | NodeOperationError {
  if (error instanceof NodeApiError || error instanceof NodeOperationError) {
    return error;
  }
  if (error instanceof MoltNetError) {
    const validationErrors = error.validationErrors?.map(
      ({ field, message }) => ({ field, message }) satisfies JsonObject,
    );
    const errorData: JsonObject = {
      message: error.message,
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
        itemIndex,
        message: error.message,
        description:
          error.detail ??
          validationErrors
            ?.map(
              ({ field, message }) => `${String(field)}: ${String(message)}`,
            )
            .join('; '),
        ...(error.statusCode === undefined
          ? {}
          : { httpCode: String(error.statusCode) }),
      },
    );
  }
  return new NodeOperationError(
    context.getNode(),
    error instanceof Error ? error : new Error(String(error)),
    { itemIndex },
  );
}

function requestOptions(
  teamId: string | undefined,
): { teamId: string } | undefined {
  return teamId ? { teamId } : undefined;
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
  const teamId =
    optionalString(options.teamId) ?? optionalString(credentials.teamId);
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
      throw new NodeOperationError(context.getNode(), error, {
        itemIndex,
        description: error.message,
      });
    }
    throw toNodeError(context, error, itemIndex);
  }
}

async function waitForTask(
  context: IExecuteFunctions,
  agent: Agent,
  credentials: MoltNetCredentials,
  itemIndex: number,
): Promise<IDataObject> {
  const taskId = (
    context.getNodeParameter('taskId', itemIndex) as string
  ).trim();
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
      `Polling interval must be at least ${minimumPollIntervalSeconds} seconds`,
      { itemIndex },
    );
  }
  if (
    !Number.isFinite(timeoutSeconds) ||
    timeoutSeconds <= 0 ||
    timeoutSeconds > maximumTimeoutSeconds
  ) {
    throw new NodeOperationError(
      context.getNode(),
      `Timeout must be between 1 and ${maximumTimeoutSeconds} seconds`,
      { itemIndex },
    );
  }
  const startedAt = Date.now();
  const deadline = startedAt + timeoutSeconds * 1_000;
  const options = requestOptions(
    taskTeamIdFromInput(context, itemIndex) ??
      optionalString(credentials.teamId),
  );
  let pollCount = 0;

  for (;;) {
    if (pollCount > 0 && Date.now() >= deadline) {
      throw waitTimeoutError(context, taskId, timeoutSeconds, itemIndex);
    }
    const task = await agent.tasks.get(taskId, options);
    if (isTerminalTaskStatus(task.status)) {
      const attempts = await agent.tasks.listAttempts(taskId, options);
      return buildTaskSnapshot(task, attempts) as unknown as IDataObject;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw waitTimeoutError(context, taskId, timeoutSeconds, itemIndex);
    }
    const backoffMs = Math.min(
      maximumPollIntervalSeconds * 1_000,
      pollIntervalSeconds * 1_000 * 2 ** Math.min(pollCount, 10),
    );
    const jitteredMs = Math.min(
      maximumPollIntervalSeconds * 1_000,
      Math.round(backoffMs * (1 + Math.random() * 0.2)),
    );
    pollCount += 1;
    await sleep(Math.min(jitteredMs, remainingMs));
  }
}

function taskTeamIdFromInput(
  context: IExecuteFunctions,
  itemIndex: number,
): string | undefined {
  const json = context.getInputData()[itemIndex]?.json;
  const task = json?.task;
  return (
    optionalString(json?.teamId) ??
    (task && typeof task === 'object' && !Array.isArray(task)
      ? optionalString((task as IDataObject).teamId)
      : undefined)
  );
}

function waitTimeoutError(
  context: IExecuteFunctions,
  taskId: string,
  timeoutSeconds: number,
  itemIndex: number,
): NodeOperationError {
  return new NodeOperationError(
    context.getNode(),
    `Timed out waiting for task ${taskId} after ${timeoutSeconds} seconds`,
    { itemIndex },
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
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Create and wait for durable MoltNet tasks',
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
            name: 'Create',
            value: 'create',
            action: 'Create a task',
            description: 'Create a validated MoltNet task',
          },
          {
            name: 'Wait',
            value: 'wait',
            action: 'Wait for a task',
            description:
              'Poll with bounded backoff until a task reaches a terminal status',
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
        description: 'Task type slug understood by the target daemon',
      },
      {
        displayName: 'Input',
        name: 'input',
        type: 'json',
        default: '{\n  "brief": "Describe the work"\n}',
        required: true,
        displayOptions: { show: { operation: ['create'], resource: ['task'] } },
        description: 'Task-type-specific JSON input',
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
          },
          {
            displayName: 'Diary ID',
            name: 'diaryId',
            type: 'string',
            default: '',
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
            description: 'Comma-separated task tags',
          },
          {
            displayName: 'Team ID',
            name: 'teamId',
            type: 'string',
            default: '',
            description: 'Overrides the team stored in the credential',
          },
          {
            displayName: 'Title',
            name: 'title',
            type: 'string',
            default: '',
          },
        ],
      },
      {
        displayName: 'Task ID',
        name: 'taskId',
        type: 'string',
        default: '={{$json.id}}',
        required: true,
        displayOptions: { show: { operation: ['wait'], resource: ['task'] } },
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
          'Finite execution cap; longer tasks can be checked by running Wait again',
      },
    ],
  };

  methods = {
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
            message: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const inputItems = this.getInputData();
    const outputItems: INodeExecutionData[] = [];
    let connectionPromise:
      | Promise<{ agent: Agent; credentials: MoltNetCredentials }>
      | undefined;

    for (let itemIndex = 0; itemIndex < inputItems.length; itemIndex += 1) {
      try {
        const operation = this.getNodeParameter(
          'operation',
          itemIndex,
        ) as string;
        connectionPromise ??= this.getCredentials<MoltNetCredentials>(
          'moltNetApi',
          itemIndex,
        ).then(async (credentials) => ({
          credentials,
          agent: await connectMoltNet(credentials),
        }));
        const { agent, credentials } = await connectionPromise;
        const result =
          operation === 'create'
            ? await createTask(this, agent, credentials, itemIndex)
            : await waitForTask(this, agent, credentials, itemIndex);
        outputItems.push({ json: result, pairedItem: { item: itemIndex } });
      } catch (error) {
        const nodeError = toNodeError(this, error, itemIndex);
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
