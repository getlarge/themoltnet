import { readConfig, writeConfig } from '@themoltnet/sdk';

import { adapters } from '../adapters/index.js';
import type { AgentAdapterOptions } from '../adapters/types.js';
import { writeEnvFile } from '../env-file.js';
import { toEnvPrefix } from '../setup.js';
import { clearState } from '../state.js';
import type { AgentType, UIAction } from '../ui/types.js';

export async function runAgentSetupPhase(opts: {
  apiUrl: string;
  repoDir: string;
  configDir: string;
  agentName: string;
  agentTypes: AgentType[];
  publicKey: string;
  fingerprint: string;
  appId: string;
  appSlug: string;
  pemPath: string;
  installationId: string;
  identityId: string;
  clientId: string;
  clientSecret: string;
  org?: string;
  dispatch: (a: UIAction) => void;
}): Promise<void> {
  const {
    apiUrl,
    repoDir,
    configDir,
    agentName,
    agentTypes,
    publicKey,
    fingerprint,
    appId,
    appSlug,
    pemPath,
    installationId,
    identityId,
    clientId,
    clientSecret,
    org,
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
          app_id: appId,
          app_slug: appSlug,
          installation_id: installationId,
          private_key_path: pemPath,
          ...(org ? { org } : {}),
        },
      },
      configDir,
    );
  }

  const prefix = toEnvPrefix(agentName);
  const mcpUrl = apiUrl.replace('://api.', '://mcp.') + '/mcp';
  const adapterOpts: AgentAdapterOptions = {
    repoDir,
    agentName,
    prefix,
    mcpUrl,
    clientId,
    clientSecret,
    appSlug,
    appId,
    pemPath,
    installationId,
  };

  dispatch({ type: 'step', key: 'skills', status: 'running' });
  for (const agentType of agentTypes) {
    const adapter = adapters[agentType];
    await adapter.writeMcpConfig(adapterOpts);
    await adapter.writeSkills(repoDir);
  }
  dispatch({ type: 'step', key: 'skills', status: 'done' });

  dispatch({ type: 'step', key: 'settings', status: 'running' });
  for (const agentType of agentTypes) {
    const adapter = adapters[agentType];
    await adapter.writeSettings(adapterOpts);
  }
  dispatch({ type: 'step', key: 'settings', status: 'done' });

  // Write shared env file (all adapters use this for `moltnet start`)
  await writeEnvFile({
    envDir: configDir,
    agentName,
    prefix,
    clientId,
    clientSecret,
    appId,
    pemPath,
    installationId,
  });

  await clearState(configDir);
}
