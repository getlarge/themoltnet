import { Configuration, OAuth2Api } from '@ory/client-fetch';

import { CONSOLE_URL } from './env.js';

export const NATIVE_CLIENT_ID = 'moltnet-native-e2e';
export const CONSOLE_CLIENT_ID = 'moltnet-console-e2e';
/** Disposable Hydra only. Never pointed at hosted configuration. */
export async function configureOperatorClients() {
  const admin = process.env.ORY_HYDRA_ADMIN_URL ?? 'http://localhost:4445';
  if (!['localhost', '127.0.0.1'].includes(new URL(admin).hostname))
    throw new Error('Operator fixtures require disposable loopback Hydra');
  const oauth = new OAuth2Api(new Configuration({ basePath: admin }));
  for (const [id, native] of [
    [NATIVE_CLIENT_ID, true],
    [CONSOLE_CLIENT_ID, false],
  ] as const) {
    const client = {
      client_id: id,
      client_name: native ? 'MoltNet Desktop' : 'MoltNet Console local control',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: native
        ? 'moltnet:provision moltnet:local-control'
        : 'moltnet:local-control',
      audience: native
        ? ['moltnet:provisioning', 'moltnet:agent-server']
        : ['moltnet:agent-server'],
      redirect_uris: [
        native
          ? 'http://127.0.0.1:17375/oauth/callback'
          : `${CONSOLE_URL}/oauth/local-callback`,
      ],
      allowed_cors_origins: native ? [] : [CONSOLE_URL],
      authorization_code_grant_access_token_lifespan: native ? '5m' : '15m',
      skip_consent: false,
    };
    try {
      await oauth.getOAuth2Client({ id });
      await oauth.setOAuth2Client({ id, oAuth2Client: client });
    } catch (error) {
      if ((error as { response?: Response }).response?.status !== 404)
        throw error;
      await oauth.createOAuth2Client({ oAuth2Client: client });
    }
  }
}
