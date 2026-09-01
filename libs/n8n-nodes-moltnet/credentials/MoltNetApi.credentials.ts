import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class MoltNetApi implements ICredentialType {
  name = 'moltNetApi';

  displayName = 'MoltNet API';

  icon = {
    light: 'file:../nodes/MoltNet/moltnet.svg',
    dark: 'file:../nodes/MoltNet/moltnet.dark.svg',
  } as const;

  // n8n's closest supported palette color to MoltNet identity amber.
  iconColor = 'orange' as const;

  documentationUrl =
    'https://github.com/getlarge/themoltnet/tree/main/libs/n8n-nodes-moltnet#credentials';

  properties: INodeProperties[] = [
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
      description: 'Default team context used when a node does not override it',
    },
    {
      displayName: 'Default Diary ID',
      name: 'diaryId',
      type: 'string',
      default: '',
      description: 'Default diary used when a node does not override it',
    },
  ];
}
