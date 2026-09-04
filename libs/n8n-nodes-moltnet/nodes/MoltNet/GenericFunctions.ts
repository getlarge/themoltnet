import {
  cancelTask,
  createClient,
  createTask,
  type CreateTaskData,
  getTask,
  listTaskAttempts,
  listTasks,
  type ListTasksData,
  type Task,
  type TaskAttempt,
  type TaskListResponse,
  type TransportRequest,
} from '@moltnet/api-client/transport';
import type {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestMethods,
  ILoadOptionsFunctions,
} from 'n8n-workflow';

export type {
  Task,
  TaskAttempt,
  TaskStatus,
} from '@moltnet/api-client/transport';
export type TaskListQuery = NonNullable<ListTasksData['query']>;
export type CreateTaskBody = CreateTaskData['body'];

export type MoltNetAuthentication = 'agentKey' | 'oauth2';
export type MoltNetCredentialType = 'moltNetAgentApi' | 'moltNetOAuth2Api';

export interface MoltNetCredentials extends IDataObject {
  apiUrl: string;
  teamId?: string;
  diaryId?: string;
}

type MoltNetNodeContext = IExecuteFunctions | ILoadOptionsFunctions;

export interface RequestContext {
  signal?: AbortSignal;
  teamId?: string;
}

export interface MoltNetClient {
  tasks: {
    cancel(
      taskId: string,
      body: { reason: string },
      options?: RequestContext,
    ): Promise<Task>;
    create(body: CreateTaskBody, options: { teamId: string }): Promise<Task>;
    get(taskId: string, options?: RequestContext): Promise<Task>;
    list(
      query: TaskListQuery,
      options: { teamId: string },
    ): Promise<TaskListResponse>;
    listAttempts(
      taskId: string,
      options?: RequestContext,
    ): Promise<TaskAttempt[]>;
  };
}

export function credentialTypeForAuthentication(
  authentication: MoltNetAuthentication,
): MoltNetCredentialType {
  return authentication === 'oauth2' ? 'moltNetOAuth2Api' : 'moltNetAgentApi';
}

export function connectMoltNet(
  context: MoltNetNodeContext,
  credentialType: MoltNetCredentialType,
  credentials: MoltNetCredentials,
): MoltNetClient {
  const transport = async <TData>({
    body,
    headers,
    method,
    signal,
    url,
  }: TransportRequest): Promise<TData> =>
    context.helpers.httpRequestWithAuthentication.call(
      context,
      credentialType,
      {
        url,
        method: method as IHttpRequestMethods,
        headers,
        ...(body === undefined ? {} : { body: body as IDataObject }),
        ...(signal === undefined ? {} : { abortSignal: signal }),
        json: true,
      },
    ) as Promise<TData>;
  const client = createClient({
    baseUrl: credentials.apiUrl.trim().replace(/\/$/u, ''),
    throwOnError: true,
    transport,
  });

  const optionalTeamHeader = (teamId?: string) =>
    teamId ? { 'x-moltnet-team-id': teamId } : undefined;

  return {
    tasks: {
      cancel: (taskId, body, options) =>
        cancelTask({
          body,
          client,
          headers: optionalTeamHeader(options?.teamId),
          path: { id: taskId },
          signal: options?.signal,
          throwOnError: true,
        }).then(({ data }) => data),
      create: (body, options) =>
        createTask({
          body,
          client,
          headers: { 'x-moltnet-team-id': options.teamId },
          throwOnError: true,
        }).then(({ data }) => data),
      get: (taskId, options) =>
        getTask({
          client,
          headers: optionalTeamHeader(options?.teamId),
          path: { id: taskId },
          signal: options?.signal,
          throwOnError: true,
        }).then(({ data }) => data),
      list: (query, options) =>
        listTasks({
          client,
          headers: { 'x-moltnet-team-id': options.teamId },
          query,
          throwOnError: true,
        }).then(({ data }) => data),
      listAttempts: (taskId, options) =>
        listTaskAttempts({
          client,
          headers: optionalTeamHeader(options?.teamId),
          path: { id: taskId },
          signal: options?.signal,
          throwOnError: true,
        }).then(({ data }) => data),
    },
  };
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
