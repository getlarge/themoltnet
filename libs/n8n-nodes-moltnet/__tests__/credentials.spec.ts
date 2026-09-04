import { describe, expect, it } from 'vitest';

import { MoltNetAgentApi } from '../credentials/MoltNetAgentApi.credentials.js';
import { MoltNetOAuth2Api } from '../credentials/MoltNetOAuth2Api.credentials.js';

const credentialTest = {
  request: {
    baseURL: '={{$credentials.apiUrl}}',
    url: '/agents/whoami',
    method: 'GET',
  },
};

describe('MoltNet credentials', () => {
  it('defines a secure Agent Key credential with MoltNet defaults', () => {
    const credential = new MoltNetAgentApi();

    expect(credential.name).toBe('moltNetAgentApi');
    expect(credential.displayName).toBe('MoltNet Agent Key API');
    expect(credential.iconColor).toBe('orange');
    expect(credential.properties.map(({ name }) => name)).toEqual([
      'apiUrl',
      'agentApiKey',
      'teamId',
      'diaryId',
    ]);
    expect(
      credential.properties.find(({ name }) => name === 'agentApiKey')
        ?.typeOptions,
    ).toEqual({ password: true });
    expect(
      credential.properties.find(({ name }) => name === 'agentApiKey')
        ?.description,
    ).toContain('agent:profile, task:manage, and task:read');
    expect(credential.authenticate).toEqual({
      type: 'generic',
      properties: {
        headers: {
          Authorization: '=Bearer {{$credentials.agentApiKey}}',
        },
      },
    });
    expect(credential.test).toEqual(credentialTest);
  });

  it('extends n8n OAuth2 with the client credentials grant', () => {
    const credential = new MoltNetOAuth2Api();

    expect(credential.name).toBe('moltNetOAuth2Api');
    expect(credential.displayName).toBe('MoltNet OAuth2 API');
    expect(credential.extends).toEqual(['oAuth2Api']);
    expect(credential.iconColor).toBe('orange');
    expect(credential.properties.map(({ name }) => name)).toEqual([
      'apiUrl',
      'grantType',
      'accessTokenUrl',
      'authQueryParameters',
      'scope',
      'authentication',
      'teamId',
      'diaryId',
    ]);
    expect(
      credential.properties.find(({ name }) => name === 'grantType')?.default,
    ).toBe('clientCredentials');
    expect(
      credential.properties.find(({ name }) => name === 'accessTokenUrl')
        ?.default,
    ).toBe('={{$self["apiUrl"]}}/oauth2/token');
    expect(
      credential.properties.find(({ name }) => name === 'authentication')
        ?.default,
    ).toBe('body');
    expect(credential.test).toEqual(credentialTest);
  });
});
