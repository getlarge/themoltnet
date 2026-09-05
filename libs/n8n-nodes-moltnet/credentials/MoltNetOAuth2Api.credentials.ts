// Mirrored byte-identically between the package and repository-root credentials
// directories because the n8n Creator Portal pre-check requires both paths.
import type {
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class MoltNetOAuth2Api implements ICredentialType {
  name = 'moltNetOAuth2Api';

  extends = ['oAuth2Api'];

  displayName = 'MoltNet OAuth2 API';

  icon = {
    light: 'file:../nodes/MoltNet/moltnet-mark.svg',
    dark: 'file:../nodes/MoltNet/moltnet-mark.dark.svg',
  } as const;

  // n8n's closest supported palette color to MoltNet identity amber.
  iconColor = 'orange' as const;

  documentationUrl =
    'https://github.com/getlarge/themoltnet/tree/main/libs/n8n-nodes-moltnet#credentials';

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
      description: 'MoltNet API URL without a trailing slash',
    },
    {
      displayName: 'Grant Type',
      name: 'grantType',
      type: 'hidden',
      default: 'clientCredentials',
    },
    {
      displayName: 'Access Token URL',
      name: 'accessTokenUrl',
      type: 'hidden',
      default: '={{$self["apiUrl"]}}/oauth2/token',
      required: true,
    },
    {
      displayName: 'Auth URI Query Parameters',
      name: 'authQueryParameters',
      type: 'hidden',
      default: '',
    },
    {
      displayName: 'Scope',
      name: 'scope',
      type: 'hidden',
      default: '',
    },
    {
      displayName: 'Authentication',
      name: 'authentication',
      type: 'hidden',
      default: 'body',
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
