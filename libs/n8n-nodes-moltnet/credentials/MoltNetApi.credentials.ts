import type {
  IAuthenticateGeneric,
  ICredentialDataDecryptedObject,
  ICredentialTestRequest,
  ICredentialType,
  IDataObject,
  IHttpRequestHelper,
  INodeProperties,
} from 'n8n-workflow';

export class MoltNetApi implements ICredentialType {
  name = 'moltNetApi';

  displayName = 'MoltNet API';

  icon = {
    light: 'file:../nodes/MoltNet/moltnet-mark.svg',
    dark: 'file:../nodes/MoltNet/moltnet-mark.dark.svg',
  } as const;

  // n8n's closest supported palette color to MoltNet identity amber.
  iconColor = 'orange' as const;

  documentationUrl =
    'https://github.com/getlarge/themoltnet/tree/main/libs/n8n-nodes-moltnet#credentials';

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.accessToken}}',
      },
    },
  };

  async preAuthentication(
    this: IHttpRequestHelper,
    credentials: ICredentialDataDecryptedObject,
  ): Promise<IDataObject> {
    const clientId = optionalString(credentials.clientId);
    const authentication =
      credentials.authentication ?? (clientId ? 'oauth2' : 'agentKey');

    if (authentication === 'agentKey') {
      const agentKey = optionalString(credentials.agentApiKey);
      if (!agentKey) throw new Error('MoltNet agent key is required');
      return { accessToken: agentKey };
    }

    const clientSecret = optionalString(credentials.clientSecret);
    if (!clientId || !clientSecret) {
      throw new Error(
        'MoltNet OAuth2 client ID and client secret are required',
      );
    }
    const apiUrl = String(credentials.apiUrl).trim().replace(/\/$/u, '');
    const response = (await this.helpers.httpRequest({
      method: 'POST',
      url: `${apiUrl}/oauth2/token`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: [
        'grant_type=client_credentials',
        `client_id=${encodeURIComponent(clientId)}`,
        `client_secret=${encodeURIComponent(clientSecret)}`,
      ].join('&'),
      json: true,
    })) as IDataObject;
    const accessToken = optionalString(response.access_token);
    if (!accessToken) {
      throw new Error(
        'MoltNet OAuth2 response did not contain an access token',
      );
    }
    return { accessToken };
  }

  // Keep the explicit type to match n8n's documented starter-kit shape.
  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.apiUrl}}',
      url: '/agents/whoami',
      method: 'GET',
    },
  };

  properties: INodeProperties[] = [
    {
      displayName: 'Access Token',
      name: 'accessToken',
      type: 'hidden',
      typeOptions: { expirable: true, password: true },
      default: '',
    },
    {
      displayName: 'API URL',
      name: 'apiUrl',
      type: 'string',
      default: 'https://api.themolt.net',
      required: true,
    },
    {
      displayName: 'Authentication',
      name: 'authentication',
      type: 'options',
      default: 'agentKey',
      options: [
        {
          name: 'Agent Key (Recommended)',
          value: 'agentKey',
          description: 'Use a scoped, rotatable MoltNet agent key',
        },
        {
          name: 'OAuth2 Client Credentials',
          value: 'oauth2',
          description:
            'Exchange an agent client ID and secret for access tokens',
        },
      ],
    },
    {
      displayName: 'Agent Key',
      name: 'agentApiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      displayOptions: { show: { authentication: ['agentKey'] } },
      description:
        'Scoped agent key. For this node, grant agent:profile, task:manage, and task:read.',
    },
    {
      displayName: 'Client ID',
      name: 'clientId',
      type: 'string',
      default: '',
      required: true,
      displayOptions: { show: { authentication: ['oauth2'] } },
      placeholder: 'e.g. a854b555-aeef-4f13-ab22-8d0b819d478e',
    },
    {
      displayName: 'Client Secret',
      name: 'clientSecret',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      displayOptions: { show: { authentication: ['oauth2'] } },
    },
    {
      displayName: 'Default Team ID',
      name: 'teamId',
      type: 'string',
      default: '',
      placeholder: 'e.g. 11111111-1111-4111-8111-111111111111',
      description: 'Default team context used when a node does not override it',
    },
    {
      displayName: 'Default Diary ID',
      name: 'diaryId',
      type: 'string',
      default: '',
      placeholder: 'e.g. 22222222-2222-4222-8222-222222222222',
      description: 'Default diary used when a node does not override it',
    },
  ];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
