import type {
  IDataObject,
  IExecuteFunctions,
  INode,
  INodeExecutionData,
} from 'n8n-workflow';

import type { MoltNetCredentials } from '../src/client.js';

const teamId = '11111111-1111-4111-8111-111111111111';
const diaryId = '22222222-2222-4222-8222-222222222222';

export const defaultCredentials: MoltNetCredentials = {
  apiUrl: 'https://fake.moltnet.test',
  authentication: 'oauth2',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  teamId,
  diaryId,
};

export interface FakeApiOptions {
  statuses?: string[];
  terminalStatus?: string;
  createStatus?: number;
  createProblem?: IDataObject;
  taskReadResponses?: Array<number | 'network'>;
  attemptReadResponses?: Array<number | 'network'>;
  attempts?: IDataObject[];
  acceptedAttemptN?: number | null;
}

export class FakeMoltNetApi {
  readonly requests: Request[] = [];
  readonly createdBodies: IDataObject[] = [];
  readonly taskId = '33333333-3333-4333-8333-333333333333';
  readonly attempt = {
    taskId: this.taskId,
    attemptN: 1,
    status: 'completed',
    output: { answer: 42 },
    outputCid: 'bafy-output',
    error: null,
  };

  private readonly statuses: string[];
  private readonly terminalStatus: string;
  private readonly createStatus: number;
  private readonly createProblem: IDataObject | undefined;
  private readonly taskReadResponses: Array<number | 'network'>;
  private readonly attemptReadResponses: Array<number | 'network'>;
  private readonly attempts: IDataObject[];
  private readonly acceptedAttemptN: number | null | undefined;
  private statusIndex = 0;
  private taskReadIndex = 0;
  private attemptReadIndex = 0;
  private taskTeamId = teamId;

  constructor(options: FakeApiOptions = {}) {
    this.statuses = options.statuses ?? [];
    this.terminalStatus = options.terminalStatus ?? 'completed';
    this.createStatus = options.createStatus ?? 201;
    this.createProblem = options.createProblem;
    this.taskReadResponses = options.taskReadResponses ?? [];
    this.attemptReadResponses = options.attemptReadResponses ?? [];
    this.attempts = options.attempts ?? [this.attempt];
    this.acceptedAttemptN = options.acceptedAttemptN;
  }

  readonly fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    this.requests.push(request.clone());
    const url = new URL(request.url);

    if (url.pathname === '/oauth2/token') {
      return jsonResponse({ access_token: 'test-token', expires_in: 3_600 });
    }
    if (url.pathname === '/agents/whoami') {
      return jsonResponse({
        subjectType: 'agent',
        identityId: '44444444-4444-4444-8444-444444444444',
        currentTeamId: teamId,
      });
    }
    if (url.pathname === '/tasks' && request.method === 'POST') {
      const body = (await request.json()) as IDataObject;
      this.createdBodies.push(body);
      if (this.createStatus >= 400) {
        return jsonResponse(
          this.createProblem ?? {
            type: 'about:blank',
            title: 'Task create failed',
            status: this.createStatus,
            detail: 'The fake API rejected the task',
          },
          this.createStatus,
        );
      }
      this.taskTeamId = request.headers.get('x-moltnet-team-id') ?? teamId;
      return jsonResponse(this.task(body), this.createStatus);
    }
    if (url.pathname === `/tasks/${this.taskId}`) {
      const responseStatus = this.taskReadResponses[this.taskReadIndex++];
      if (responseStatus === 'network') {
        throw new TypeError('The fake network dropped the task read');
      }
      if (responseStatus !== undefined && responseStatus >= 400) {
        return problemResponse(responseStatus, 'Task read failed');
      }
      const status = this.statuses[this.statusIndex++] ?? this.terminalStatus;
      return jsonResponse(this.task({}, status));
    }
    if (url.pathname === `/tasks/${this.taskId}/attempts`) {
      const responseStatus = this.attemptReadResponses[this.attemptReadIndex++];
      if (responseStatus === 'network') {
        throw new TypeError('The fake network dropped the attempts read');
      }
      if (responseStatus !== undefined && responseStatus >= 400) {
        return problemResponse(responseStatus, 'Attempt read failed');
      }
      return jsonResponse(this.attempts);
    }

    return jsonResponse({ title: 'Not found', status: 404 }, 404);
  };

  private task(body: IDataObject, status = 'queued'): IDataObject {
    return {
      id: this.taskId,
      teamId: this.taskTeamId,
      diaryId,
      taskType: body.taskType ?? 'freeform',
      input: body.input ?? { brief: 'test' },
      title: body.title ?? null,
      tags: body.tags ?? [],
      maxAttempts: body.maxAttempts ?? 1,
      correlationId:
        body.correlationId ?? '55555555-5555-4555-8555-555555555555',
      status,
      acceptedAttemptN:
        this.acceptedAttemptN === undefined
          ? status === 'completed'
            ? 1
            : null
          : this.acceptedAttemptN,
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    };
  }
}

export interface HarnessOptions {
  items?: INodeExecutionData[];
  parameters: IDataObject | IDataObject[];
  credentials?: MoltNetCredentials | MoltNetCredentials[];
  continueOnFail?: boolean;
  cancelSignal?: AbortSignal;
}

export function createExecuteContext(
  options: HarnessOptions,
): IExecuteFunctions {
  const parameters = Array.isArray(options.parameters)
    ? options.parameters
    : [options.parameters];
  const items = options.items ?? [{ json: {} }];
  const node: INode = {
    id: 'molt-net-test',
    name: 'MoltNet',
    type: '@themoltnet/n8n-nodes-moltnet.moltNet',
    typeVersion: 1,
    position: [0, 0],
    parameters: {},
  };

  return {
    continueOnFail: () => options.continueOnFail ?? false,
    getCredentials: async (_type: string, itemIndex: number) => {
      const credentials = options.credentials ?? defaultCredentials;
      return Array.isArray(credentials)
        ? (credentials[itemIndex] ?? credentials[0])
        : credentials;
    },
    getExecutionCancelSignal: () => options.cancelSignal,
    getInputData: () => items,
    getNode: () => node,
    getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) =>
      parameters[itemIndex]?.[name] ?? parameters[0]?.[name] ?? fallback,
  } as unknown as IExecuteFunctions;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function problemResponse(status: number, title: string): Response {
  return jsonResponse(
    {
      type: 'about:blank',
      title,
      status,
      detail: `The fake API returned HTTP ${status}`,
    },
    status,
  );
}
