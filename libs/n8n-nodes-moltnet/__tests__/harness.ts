import type {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  INode,
  INodeExecutionData,
} from 'n8n-workflow';

import type { MoltNetCredentials } from '../nodes/MoltNet/GenericFunctions.js';

const teamId = '11111111-1111-4111-8111-111111111111';
const diaryId = '22222222-2222-4222-8222-222222222222';

export const defaultCredentials: MoltNetCredentials = {
  apiUrl: 'https://fake.moltnet.test',
  agentApiKey: 'opaque-agent-key',
  teamId,
  diaryId,
};

export interface FakeApiOptions {
  statuses?: string[];
  terminalStatus?: string;
  createStatus?: number;
  createResponses?: number[];
  createProblem?: IDataObject;
  taskReadResponses?: Array<number | 'hang' | 'network'>;
  attemptReadResponses?: Array<number | 'hang' | 'network'>;
  attempts?: IDataObject[];
  acceptedAttemptN?: number | null;
}

export class FakeMoltNetApi {
  readonly requests: Request[] = [];
  readonly createdBodies: IDataObject[] = [];
  readonly cancellationReasons: string[] = [];
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
  private readonly createResponses: number[];
  private readonly createProblem: IDataObject | undefined;
  private readonly taskReadResponses: Array<number | 'hang' | 'network'>;
  private readonly attemptReadResponses: Array<number | 'hang' | 'network'>;
  private readonly attempts: IDataObject[];
  private readonly acceptedAttemptN: number | null | undefined;
  private statusIndex = 0;
  private createIndex = 0;
  private taskReadIndex = 0;
  private attemptReadIndex = 0;
  private taskTeamId = teamId;

  constructor(options: FakeApiOptions = {}) {
    this.statuses = options.statuses ?? [];
    this.terminalStatus = options.terminalStatus ?? 'completed';
    this.createStatus = options.createStatus ?? 201;
    this.createResponses = options.createResponses ?? [];
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
    if (url.pathname === '/tasks' && request.method === 'GET') {
      return jsonResponse({
        items: [this.task({}, 'queued')],
        total: 1,
      });
    }
    if (url.pathname === '/tasks' && request.method === 'POST') {
      const body = (await request.json()) as IDataObject;
      this.createdBodies.push(body);
      const createStatus =
        this.createResponses[this.createIndex++] ?? this.createStatus;
      if (createStatus >= 400) {
        return jsonResponse(
          this.createProblem ?? {
            type: 'about:blank',
            title: 'Task create failed',
            status: createStatus,
            detail: 'The fake API rejected the task',
          },
          createStatus,
        );
      }
      this.taskTeamId = request.headers.get('x-moltnet-team-id') ?? teamId;
      return jsonResponse(this.task(body), createStatus);
    }
    if (
      url.pathname === `/tasks/${this.taskId}/cancel` &&
      request.method === 'POST'
    ) {
      const body = (await request.json()) as IDataObject;
      this.cancellationReasons.push(String(body.reason));
      return jsonResponse(this.task({}, 'cancelled'));
    }
    if (url.pathname === `/tasks/${this.taskId}`) {
      const responseStatus = this.taskReadResponses[this.taskReadIndex++];
      if (responseStatus === 'network') {
        throw new TypeError('The fake network dropped the task read');
      }
      if (responseStatus === 'hang') {
        return waitForAbort(request.signal);
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
      if (responseStatus === 'hang') {
        return waitForAbort(request.signal);
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
      queuedAt: '2026-08-31T00:00:00.000Z',
      expiresAt: '2026-08-31T01:00:00.000Z',
      completedAt: status === 'completed' ? '2026-08-31T00:01:00.000Z' : null,
    };
  }
}

export interface HarnessOptions {
  items?: INodeExecutionData[];
  parameters: IDataObject | IDataObject[];
  credentials?: MoltNetCredentials | MoltNetCredentials[];
  continueOnFail?: boolean;
  cancelSignal?: AbortSignal;
  typeVersion?: number;
  toolExecution?: boolean;
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
    typeVersion: options.typeVersion ?? 1,
    position: [0, 0],
    parameters: {},
  };
  let activeCredentials = Array.isArray(options.credentials)
    ? (options.credentials[0] ?? defaultCredentials)
    : (options.credentials ?? defaultCredentials);
  const tokens = new Map<string, string>();

  const httpRequest = async (requestOptions: IHttpRequestOptions) => {
    const headers = new Headers(
      Object.entries(requestOptions.headers ?? {}).flatMap(([name, value]) =>
        value === undefined || value === null
          ? []
          : [[name, String(value)] as [string, string]],
      ),
    );
    let body: BodyInit | undefined;
    if (requestOptions.body !== undefined) {
      body =
        typeof requestOptions.body === 'string'
          ? requestOptions.body
          : JSON.stringify(requestOptions.body);
    }
    const response = await fetch(requestOptions.url, {
      method: requestOptions.method,
      headers,
      body,
      signal: requestOptions.abortSignal as AbortSignal | undefined,
    });
    const data = (await response.json()) as IDataObject;
    if (!response.ok) {
      throw {
        response: { data, status: response.status },
        statusCode: response.status,
      };
    }
    return data;
  };

  const helpers = {
    httpRequest,
    httpRequestWithAuthentication: async (
      credentialsType: string,
      requestOptions: IHttpRequestOptions,
    ) => {
      const cacheKey = JSON.stringify(activeCredentials);
      let token = tokens.get(cacheKey);
      if (!token) {
        if (credentialsType === 'moltNetAgentApi') {
          token = String(activeCredentials.agentApiKey);
        } else {
          const response = (await httpRequest({
            method: 'POST',
            url: `${String(activeCredentials.apiUrl)}/oauth2/token`,
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: [
              'grant_type=client_credentials',
              `client_id=${encodeURIComponent(String(activeCredentials.clientId))}`,
              `client_secret=${encodeURIComponent(String(activeCredentials.clientSecret))}`,
            ].join('&'),
            json: true,
          })) as IDataObject;
          token = String(response.access_token);
        }
        tokens.set(cacheKey, token);
      }
      return httpRequest({
        ...requestOptions,
        headers: {
          ...requestOptions.headers,
          authorization: `Bearer ${token}`,
        },
      });
    },
  };

  return {
    continueOnFail: () => options.continueOnFail ?? false,
    getCredentials: async (_type: string, itemIndex: number) => {
      const credentials = options.credentials ?? defaultCredentials;
      activeCredentials = Array.isArray(credentials)
        ? (credentials[itemIndex] ?? credentials[0])
        : credentials;
      return activeCredentials;
    },
    getExecutionCancelSignal: () => options.cancelSignal,
    getInputData: () => items,
    isToolExecution: () => options.toolExecution ?? false,
    getNode: () => node,
    helpers,
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

function waitForAbort(signal: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const onAbort = () =>
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
