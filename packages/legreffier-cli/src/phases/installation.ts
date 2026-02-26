import { readConfig } from '@themoltnet/sdk';
import open from 'open';

import { pollUntil } from '../api.js';
import type { InstallationResult, UIAction } from '../ui/types.js';

export async function runInstallationPhase(opts: {
  apiUrl: string;
  configDir: string;
  workflowId: string;
  appSlug: string;
  dispatch: (a: UIAction) => void;
}): Promise<InstallationResult> {
  const { apiUrl, configDir, workflowId, appSlug, dispatch } = opts;
  const existingConfig = await readConfig(configDir);

  if (
    existingConfig?.github?.installation_id &&
    existingConfig?.oauth2?.client_id
  ) {
    dispatch({ type: 'step', key: 'installation', status: 'skipped' });
    return {
      installationId: existingConfig.github.installation_id,
      identityId: existingConfig.identity_id ?? '',
      clientId: existingConfig.oauth2.client_id,
      clientSecret: existingConfig.oauth2.client_secret,
    };
  }

  dispatch({ type: 'phase', phase: 'installation' });
  dispatch({ type: 'step', key: 'installation', status: 'running' });
  const installUrl = `https://github.com/apps/${appSlug}/installations/new`;
  dispatch({ type: 'installationUrl', url: installUrl });
  await open(installUrl);

  const result = await pollUntil(apiUrl, workflowId, ['completed'], (status) =>
    dispatch({ type: 'serverStatus', status }),
  );

  dispatch({ type: 'step', key: 'installation', status: 'done' });
  return {
    installationId: '',
    identityId: result.identityId ?? '',
    clientId: result.clientId ?? '',
    clientSecret: result.clientSecret ?? '',
  };
}
