import {
  type McpConfig,
  readConfig,
  writeConfig,
  writeMcpConfig,
} from '@themoltnet/sdk';

import { downloadSkills, toEnvPrefix, writeSettingsLocal } from '../setup.js';
import { clearState } from '../state.js';
import type { UIAction } from '../ui/types.js';

export async function runAgentSetupPhase(opts: {
  apiUrl: string;
  repoDir: string;
  configDir: string;
  agentName: string;
  publicKey: string;
  fingerprint: string;
  appSlug: string;
  pemPath: string;
  installationId: string;
  identityId: string;
  clientId: string;
  clientSecret: string;
  dispatch: (a: UIAction) => void;
}): Promise<void> {
  const {
    apiUrl,
    repoDir,
    configDir,
    agentName,
    publicKey,
    fingerprint,
    appSlug,
    pemPath,
    installationId,
    identityId,
    clientId,
    clientSecret,
    dispatch,
  } = opts;

  dispatch({ type: 'phase', phase: 'agent_setup' });
  const existingConfig = await readConfig(configDir);

  if (!existingConfig?.oauth2?.client_id && clientId) {
    await writeConfig(
      {
        identity_id: identityId,
        registered_at: new Date().toISOString(),
        oauth2: { client_id: clientId, client_secret: clientSecret },
        keys: {
          public_key: publicKey,
          private_key: existingConfig?.keys?.private_key ?? '',
          fingerprint,
        },
        endpoints: {
          api: apiUrl,
          mcp: apiUrl.replace('://api.', '://mcp.') + '/mcp',
        },
        github: {
          app_id: appSlug,
          app_slug: appSlug,
          installation_id: installationId,
          private_key_path: pemPath,
        },
      },
      configDir,
    );
  }

  // Write .mcp.json with env-var references — real creds go in settings.local.json
  if (clientId) {
    const prefix = toEnvPrefix(agentName);
    const mcpUrl = apiUrl.replace('://api.', '://mcp.') + '/mcp';
    await writeMcpConfig(
      {
        mcpServers: {
          [agentName]: {
            type: 'http',
            url: mcpUrl,
            headers: {
              'X-Client-Id': `\${${prefix}_CLIENT_ID}`,
              'X-Client-Secret': `\${${prefix}_CLIENT_SECRET}`,
            },
          },
        },
      } as McpConfig,
      repoDir,
    );
  }

  dispatch({ type: 'step', key: 'skills', status: 'running' });
  await downloadSkills(repoDir);
  dispatch({ type: 'step', key: 'skills', status: 'done' });

  dispatch({ type: 'step', key: 'settings', status: 'running' });
  await writeSettingsLocal({
    repoDir,
    agentName,
    appSlug,
    pemPath,
    installationId,
    clientId,
    clientSecret,
  });
  dispatch({ type: 'step', key: 'settings', status: 'done' });

  await clearState(configDir);
}
