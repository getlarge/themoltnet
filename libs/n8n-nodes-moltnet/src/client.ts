import { type Agent, connect } from '@themoltnet/sdk';
import type { IDataObject } from 'n8n-workflow';

export interface MoltNetCredentials extends IDataObject {
  apiUrl: string;
  authentication?: 'agentKey' | 'oauth2';
  agentApiKey?: string;
  clientId?: string;
  clientSecret?: string;
  teamId?: string;
  diaryId?: string;
}

export function connectMoltNet(
  credentials: MoltNetCredentials,
): Promise<Agent> {
  const agentKey = optionalString(credentials.agentApiKey);
  const clientId = optionalString(credentials.clientId);
  const authentication =
    credentials.authentication ?? (clientId ? 'oauth2' : 'agentKey');

  if (authentication === 'agentKey') {
    if (!agentKey) {
      return Promise.reject(new Error('MoltNet agent key is required'));
    }
    return connect({
      apiUrl: credentials.apiUrl.trim(),
      agentKey,
    });
  }

  if (!clientId || !credentials.clientSecret) {
    return Promise.reject(
      new Error('MoltNet OAuth2 client ID and client secret are required'),
    );
  }
  return connect({
    apiUrl: credentials.apiUrl.trim(),
    clientId,
    clientSecret: credentials.clientSecret,
  });
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
