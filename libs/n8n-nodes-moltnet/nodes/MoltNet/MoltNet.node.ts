import { type Agent, MoltNetError, TaskBuildError } from '@themoltnet/sdk';
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
import {
  buildTaskSnapshot,
  isTerminalTaskStatus,
} from '../../src/task-snapshot.js';

const defaultPollIntervalSeconds = 5;
const defaultTimeoutSeconds = 1_800;

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
    return new NodeApiError(
      context.getNode(),
      {
        message: error.message,
        name: error.name,
      } as JsonObject,
      { itemIndex, message: error.message },
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
  const startedAt = Date.now();
  const options = requestOptions(optionalString(credentials.teamId));

  for (;;) {
    const task = await agent.tasks.get(taskId, options);
    if (isTerminalTaskStatus(task.status)) {
      const attempts = await agent.tasks.listAttempts(taskId, options);
      return buildTaskSnapshot(task, attempts) as unknown as IDataObject;
    }
    if (
      timeoutSeconds > 0 &&
      Date.now() - startedAt >= timeoutSeconds * 1_000
    ) {
      throw new NodeOperationError(
        context.getNode(),
        `Timed out waiting for task ${taskId} after ${timeoutSeconds} seconds`,
        { itemIndex },
      );
    }
    await sleep(pollIntervalSeconds * 1_000);
  }
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
            description: 'Poll until a task reaches a terminal status',
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
        typeOptions: { minValue: 0.01 },
        default: defaultPollIntervalSeconds,
        displayOptions: { show: { operation: ['wait'], resource: ['task'] } },
      },
      {
        displayName: 'Timeout (Seconds)',
        name: 'timeout',
        type: 'number',
        typeOptions: { minValue: 0 },
        default: defaultTimeoutSeconds,
        displayOptions: { show: { operation: ['wait'], resource: ['task'] } },
        description: 'Set to 0 to wait without a timeout',
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

    for (let itemIndex = 0; itemIndex < inputItems.length; itemIndex += 1) {
      try {
        const operation = this.getNodeParameter(
          'operation',
          itemIndex,
        ) as string;
        const credentials = await this.getCredentials<MoltNetCredentials>(
          'moltNetApi',
          itemIndex,
        );
        const agent = await connectMoltNet(credentials);
        const result =
          operation === 'create'
            ? await createTask(this, agent, credentials, itemIndex)
            : await waitForTask(this, agent, credentials, itemIndex);
        outputItems.push({ json: result, pairedItem: { item: itemIndex } });
      } catch (error) {
        const nodeError = toNodeError(this, error, itemIndex);
        if (!this.continueOnFail()) throw nodeError;
        outputItems.push({
          json: { error: nodeError.message },
          error: nodeError,
          pairedItem: { item: itemIndex },
        });
      }
    }

    return [outputItems];
  }
}
