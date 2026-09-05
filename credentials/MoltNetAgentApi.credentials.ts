// Mirrored byte-identically between the package and repository-root credentials
// directories because the n8n Creator Portal pre-check requires both paths.
import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class MoltNetAgentApi implements ICredentialType {
  name = 'moltNetAgentApi';

  displayName = 'MoltNet Agent Key API';

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
        Authorization: '=Bearer {{$credentials.agentApiKey}}',
      },
    },
  };

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
      displayName: 'API URL',
      name: 'apiUrl',
      type: 'string',
      default: 'https://api.themolt.net',
      required: true,
    },
    {
      displayName: 'Agent Key',
      name: 'agentApiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description:
        'Scoped Agent Key with agent:profile, task:manage, and task:read permissions',
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
