import type {
  ICredentialsDecrypted,
  ICredentialTestFunctions,
} from 'n8n-workflow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MoltNetApi } from '../credentials/MoltNetApi.credentials.js';
import { MoltNet } from '../nodes/MoltNet/MoltNet.node.js';
import { defaultCredentials, FakeMoltNetApi } from './harness.js';

describe('MoltNet API credentials', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('defines secure credentials and MoltNet context defaults', () => {
    const credential = new MoltNetApi();

    expect(credential.name).toBe('moltNetApi');
    expect(credential.iconColor).toBe('orange');
    expect(credential.properties.map(({ name }) => name)).toEqual([
      'apiUrl',
      'authentication',
      'agentApiKey',
      'clientId',
      'clientSecret',
      'teamId',
      'diaryId',
    ]);
    expect(
      credential.properties.find(({ name }) => name === 'agentApiKey')
        ?.typeOptions,
    ).toEqual({ password: true });
    expect(
      credential.properties.find(({ name }) => name === 'clientSecret')
        ?.typeOptions,
    ).toEqual({ password: true });
  });

  it('prefers a scoped agent key and skips the OAuth2 token exchange', async () => {
    const api = new FakeMoltNetApi();
    vi.stubGlobal('fetch', api.fetch);
    const node = new MoltNet();
    const testCredential = node.methods.credentialTest.moltNetApiCredentialTest;

    const result = await testCredential.call(
      {} as ICredentialTestFunctions,
      {
        id: 'credential-id',
        name: 'MoltNet agent key',
        type: 'moltNetApi',
        data: {
          ...defaultCredentials,
          authentication: 'agentKey',
          agentApiKey: 'opaque-agent-key',
          clientId: '',
          clientSecret: '',
        },
      } as ICredentialsDecrypted,
    );

    expect(result.status).toBe('OK');
    expect(api.requests.some(({ url }) => url.endsWith('/oauth2/token'))).toBe(
      false,
    );
    const whoami = api.requests.find(({ url }) =>
      url.endsWith('/agents/whoami'),
    );
    expect(whoami?.headers.get('Authorization')).toBe(
      'Bearer opaque-agent-key',
    );
  });

  it('keeps credentials saved before authentication mode existed on OAuth2', async () => {
    const api = new FakeMoltNetApi();
    vi.stubGlobal('fetch', api.fetch);
    const node = new MoltNet();

    await node.methods.credentialTest.moltNetApiCredentialTest.call(
      {} as ICredentialTestFunctions,
      {
        id: 'legacy-credential-id',
        name: 'Legacy MoltNet OAuth2',
        type: 'moltNetApi',
        data: {
          apiUrl: defaultCredentials.apiUrl,
          clientId: defaultCredentials.clientId,
          clientSecret: defaultCredentials.clientSecret,
          teamId: defaultCredentials.teamId,
          diaryId: defaultCredentials.diaryId,
        },
      } as ICredentialsDecrypted,
    );

    expect(api.requests.some(({ url }) => url.endsWith('/oauth2/token'))).toBe(
      true,
    );
  });

  it('tests credentials through the SDK agents.whoami endpoint', async () => {
    const api = new FakeMoltNetApi();
    vi.stubGlobal('fetch', api.fetch);
    const node = new MoltNet();
    const testCredential = node.methods.credentialTest.moltNetApiCredentialTest;

    const result = await testCredential.call(
      {} as ICredentialTestFunctions,
      {
        id: 'credential-id',
        name: 'MoltNet test',
        type: 'moltNetApi',
        data: defaultCredentials,
      } as ICredentialsDecrypted,
    );

    expect(result).toEqual({
      status: 'OK',
      message: 'Authentication successful',
    });
    expect(api.requests.some(({ url }) => url.endsWith('/agents/whoami'))).toBe(
      true,
    );
  });

  it('guides users when credential authentication is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const request = new Request(input);
        if (new URL(request.url).pathname === '/oauth2/token') {
          return new Response(
            JSON.stringify({
              type: 'about:blank',
              title: 'Unauthorized',
              status: 401,
            }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(null, { status: 500 });
      }),
    );
    const node = new MoltNet();

    const result =
      await node.methods.credentialTest.moltNetApiCredentialTest.call(
        {} as ICredentialTestFunctions,
        {
          id: 'rejected-credential-id',
          name: 'Rejected MoltNet credential',
          type: 'moltNetApi',
          data: defaultCredentials,
        } as ICredentialsDecrypted,
      );

    expect(result).toEqual({
      status: 'Error',
      message:
        'Authentication was rejected. Check the selected authentication method and secret.',
    });
  });
});
