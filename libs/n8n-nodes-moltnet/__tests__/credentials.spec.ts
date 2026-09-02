import type {
  ICredentialDataDecryptedObject,
  IHttpRequestHelper,
} from 'n8n-workflow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MoltNetApi } from '../credentials/MoltNetApi.credentials.js';
import {
  createExecuteContext,
  defaultCredentials,
  FakeMoltNetApi,
} from './harness.js';

describe('MoltNet API credentials', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('defines secure credentials and MoltNet context defaults', () => {
    const credential = new MoltNetApi();

    expect(credential.name).toBe('moltNetApi');
    expect(credential.iconColor).toBe('orange');
    expect(credential.properties.map(({ name }) => name)).toEqual([
      'accessToken',
      'apiUrl',
      'authentication',
      'agentApiKey',
      'clientId',
      'clientSecret',
      'teamId',
      'diaryId',
    ]);
    expect(
      credential.properties.find(({ name }) => name === 'accessToken')
        ?.typeOptions,
    ).toEqual({ expirable: true, password: true });
    expect(
      credential.properties.find(({ name }) => name === 'agentApiKey')
        ?.typeOptions,
    ).toEqual({ password: true });
    expect(
      credential.properties.find(({ name }) => name === 'clientSecret')
        ?.typeOptions,
    ).toEqual({ password: true });
  });

  it('uses n8n native pre-authentication and credential testing', () => {
    const credential = new MoltNetApi();

    expect(credential.authenticate).toEqual({
      type: 'generic',
      properties: {
        headers: {
          Authorization: '=Bearer {{$credentials.accessToken}}',
        },
      },
    });
    expect(credential.test).toEqual({
      request: {
        baseURL: '={{$credentials.apiUrl}}',
        url: '/agents/whoami',
      },
    });
  });

  it('prefers a scoped agent key and skips the OAuth2 token exchange', async () => {
    const httpRequest = vi.fn();
    const result = await new MoltNetApi().preAuthentication.call(
      { helpers: { httpRequest } } as IHttpRequestHelper,
      {
        ...defaultCredentials,
        authentication: 'agentKey',
        agentApiKey: 'opaque-agent-key',
        clientId: '',
        clientSecret: '',
      },
    );

    expect(result).toEqual({ accessToken: 'opaque-agent-key' });
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('keeps credentials saved before authentication mode existed on OAuth2', async () => {
    const api = new FakeMoltNetApi();
    vi.stubGlobal('fetch', api.fetch);
    const context = createExecuteContext({ parameters: {} });

    const result = await new MoltNetApi().preAuthentication.call(
      { helpers: { httpRequest: context.helpers.httpRequest } },
      {
        apiUrl: defaultCredentials.apiUrl,
        clientId: defaultCredentials.clientId,
        clientSecret: defaultCredentials.clientSecret,
        teamId: defaultCredentials.teamId,
        diaryId: defaultCredentials.diaryId,
      } as ICredentialDataDecryptedObject,
    );

    expect(result).toEqual({ accessToken: 'test-token' });
    expect(api.requests.some(({ url }) => url.endsWith('/oauth2/token'))).toBe(
      true,
    );
  });

  it('exchanges OAuth2 credentials with form encoding', async () => {
    const httpRequest = vi.fn(async () => ({ access_token: 'oauth-token' }));

    const result = await new MoltNetApi().preAuthentication.call(
      { helpers: { httpRequest } } as IHttpRequestHelper,
      defaultCredentials as unknown as ICredentialDataDecryptedObject,
    );

    expect(result).toEqual({ accessToken: 'oauth-token' });
    expect(httpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: `${defaultCredentials.apiUrl}/oauth2/token`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials&client_id=client-id&client_secret=client-secret',
      }),
    );
  });

  it('rejects incomplete authentication values', async () => {
    const httpRequest = vi.fn();
    const credential = new MoltNetApi();

    await expect(
      credential.preAuthentication.call(
        { helpers: { httpRequest } } as IHttpRequestHelper,
        {
          ...defaultCredentials,
          authentication: 'agentKey',
          agentApiKey: '',
        },
      ),
    ).rejects.toThrow('MoltNet agent key is required');
    await expect(
      credential.preAuthentication.call(
        { helpers: { httpRequest } } as IHttpRequestHelper,
        {
          ...defaultCredentials,
          authentication: 'oauth2',
          clientSecret: '',
        },
      ),
    ).rejects.toThrow(
      'MoltNet OAuth2 client ID and client secret are required',
    );
  });
});
