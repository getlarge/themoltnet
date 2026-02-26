import { homedir } from 'node:os';
import { join } from 'node:path';

import { readConfig } from '@themoltnet/sdk';
import open from 'open';

import { pollUntil } from '../api.js';
import { exchangeManifestCode, writePem } from '../github.js';
import { readState, writeState } from '../state.js';
import type { GithubAppResult, UIAction } from '../ui/types.js';

export async function runGithubAppPhase(opts: {
  apiUrl: string;
  agentName: string;
  configDir: string;
  projectSlug: string;
  publicKey: string;
  privateKey: string;
  fingerprint: string;
  workflowId: string;
  manifestFormUrl: string;
  dispatch: (a: UIAction) => void;
}): Promise<GithubAppResult> {
  const {
    apiUrl,
    agentName,
    configDir,
    projectSlug,
    publicKey,
    privateKey,
    fingerprint,
    workflowId,
    manifestFormUrl,
    dispatch,
  } = opts;

  const existingConfig = await readConfig(configDir);
  const existingState = await readState(projectSlug);

  if (existingConfig?.github?.app_id) {
    dispatch({ type: 'step', key: 'githubApp', status: 'skipped' });
    dispatch({
      type: 'appSlug',
      appSlug: existingConfig.github.app_slug ?? '',
    });
    return {
      appSlug: existingConfig.github.app_slug ?? '',
      pemPath: existingConfig.github.private_key_path,
      installationId: existingConfig.github.installation_id,
      skipped: true,
    };
  }

  // State has appSlug but config wasn't written yet (crash after exchange, before agent setup).
  // PEM was already written to disk by writePem — reconstruct the path.
  if (existingState?.appSlug && existingState?.appId) {
    const pemPath = join(
      homedir(),
      '.config',
      'moltnet',
      projectSlug,
      `${existingState.appSlug}.pem`,
    );
    dispatch({ type: 'step', key: 'githubApp', status: 'skipped' });
    dispatch({ type: 'appSlug', appSlug: existingState.appSlug });
    return {
      appSlug: existingState.appSlug,
      pemPath,
      installationId: '',
      skipped: true,
    };
  }

  dispatch({ type: 'phase', phase: 'github_app' });
  dispatch({ type: 'step', key: 'githubApp', status: 'running' });

  dispatch({ type: 'manifestFormUrl', url: manifestFormUrl });
  await open(manifestFormUrl);

  const codeResult = await pollUntil(
    apiUrl,
    workflowId,
    ['github_code_ready', 'awaiting_installation', 'completed'],
    (status) => dispatch({ type: 'serverStatus', status }),
  );

  if (!codeResult.githubCode) {
    throw new Error('GitHub code not available in onboarding status');
  }

  const ghCreds = await exchangeManifestCode(codeResult.githubCode);
  dispatch({ type: 'appSlug', appSlug: ghCreds.appSlug });

  const pemPath = await writePem(ghCreds.pem, ghCreds.appSlug, projectSlug);
  await writeState(
    {
      workflowId,
      publicKey,
      privateKey,
      fingerprint,
      agentName,
      phase: 'awaiting_installation',
      appId: ghCreds.appId,
      appSlug: ghCreds.appSlug,
    },
    projectSlug,
  );

  dispatch({ type: 'step', key: 'githubApp', status: 'done' });
  return {
    appSlug: ghCreds.appSlug,
    pemPath,
    installationId: '',
    skipped: false,
  };
}
