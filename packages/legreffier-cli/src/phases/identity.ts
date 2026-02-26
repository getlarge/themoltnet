import { cryptoService } from '@moltnet/crypto-service';
import { readConfig, writeConfig } from '@themoltnet/sdk';

import { checkWorkflowLive, startOnboarding } from '../api.js';
import { checkAppNameAvailable, suggestAppNames } from '../github.js';
import { clearState, readState, writeState } from '../state.js';
import type { UIAction } from '../ui/types.js';
import type { IdentityResult } from '../ui/types.js';

export async function runIdentityPhase(opts: {
  apiUrl: string;
  agentName: string;
  configDir: string;
  projectSlug: string;
  dispatch: (a: UIAction) => void;
}): Promise<IdentityResult> {
  const { apiUrl, agentName, configDir, projectSlug, dispatch } = opts;
  const existingConfig = await readConfig(configDir);
  const existingState = await readState(projectSlug, agentName);

  if (existingConfig?.keys?.public_key && existingConfig?.oauth2?.client_id) {
    dispatch({ type: 'step', key: 'keypair', status: 'skipped' });
    dispatch({ type: 'step', key: 'register', status: 'skipped' });
    dispatch({
      type: 'fingerprint',
      fingerprint: existingConfig.keys.fingerprint,
    });
    const workflowId =
      existingState?.workflowId && !existingConfig.github?.app_id
        ? existingState.workflowId
        : '';
    return {
      publicKey: existingConfig.keys.public_key,
      privateKey: existingConfig.keys.private_key,
      fingerprint: existingConfig.keys.fingerprint,
      workflowId,
      manifestFormUrl: '',
      clientId: existingConfig.oauth2.client_id,
      clientSecret: existingConfig.oauth2.client_secret,
      skipped: true,
    };
  }

  // Registration already started (workflow in state file) — only resume if
  // the workflow is still alive. Source keys from config if available, else
  // from state (state always has publicKey/fingerprint written at start).
  const resumePublicKey =
    existingConfig?.keys?.public_key ?? existingState?.publicKey;
  const resumeFingerprint =
    existingConfig?.keys?.fingerprint ?? existingState?.fingerprint;
  if (existingState?.workflowId && resumePublicKey && resumeFingerprint) {
    const live = await checkWorkflowLive(apiUrl, existingState.workflowId);
    if (live) {
      dispatch({ type: 'step', key: 'keypair', status: 'skipped' });
      dispatch({ type: 'step', key: 'register', status: 'skipped' });
      dispatch({ type: 'fingerprint', fingerprint: resumeFingerprint });
      const resumePrivateKey =
        existingConfig?.keys?.private_key ?? existingState.privateKey;
      // Write config now if it's missing (crash before early write completed)
      if (!existingConfig?.keys?.public_key) {
        await writeConfig(
          {
            identity_id: '',
            registered_at: new Date().toISOString(),
            oauth2: { client_id: '', client_secret: '' },
            keys: {
              public_key: resumePublicKey,
              private_key: resumePrivateKey,
              fingerprint: resumeFingerprint,
            },
            endpoints: { api: apiUrl, mcp: '' },
          },
          configDir,
        );
      }
      return {
        publicKey: resumePublicKey,
        privateKey: resumePrivateKey,
        fingerprint: resumeFingerprint,
        workflowId: existingState.workflowId,
        manifestFormUrl: '',
        clientId: existingConfig?.oauth2?.client_id ?? '',
        clientSecret: existingConfig?.oauth2?.client_secret ?? '',
        skipped: true,
      };
    }
    // Workflow expired — discard stale state and start fresh
    await clearState(projectSlug, agentName);
  }

  const available = await checkAppNameAvailable(agentName);
  if (!available) {
    const suggestions = await suggestAppNames(agentName);
    const hint =
      suggestions.length > 0
        ? ` Try one of: ${suggestions.map((s) => `--name ${s}`).join(', ')}`
        : ` Try adding a suffix like --name ${agentName}-bot`;
    throw new Error(`GitHub App name "${agentName}" is already taken.${hint}`);
  }

  dispatch({ type: 'step', key: 'keypair', status: 'running' });
  const kp = await cryptoService.generateKeyPair();
  dispatch({ type: 'fingerprint', fingerprint: kp.fingerprint });
  dispatch({ type: 'step', key: 'keypair', status: 'done' });

  dispatch({ type: 'step', key: 'register', status: 'running' });
  const started = await startOnboarding(apiUrl, {
    publicKey: kp.publicKey,
    fingerprint: kp.fingerprint,
    agentName,
  });
  await writeState(
    {
      workflowId: started.workflowId,
      publicKey: kp.publicKey,
      privateKey: kp.privateKey,
      fingerprint: kp.fingerprint,
      agentName,
      phase: 'awaiting_github',
    },
    projectSlug,
    agentName,
  );

  // Write keys to config early so exportSSHKey can find them in runGitSetupPhase
  await writeConfig(
    {
      identity_id: '',
      registered_at: new Date().toISOString(),
      oauth2: { client_id: '', client_secret: '' },
      keys: {
        public_key: kp.publicKey,
        private_key: kp.privateKey,
        fingerprint: kp.fingerprint,
      },
      endpoints: { api: apiUrl, mcp: '' },
    },
    configDir,
  );

  dispatch({ type: 'step', key: 'register', status: 'done' });

  return {
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
    fingerprint: kp.fingerprint,
    workflowId: started.workflowId,
    manifestFormUrl: started.manifestFormUrl,
    clientId: '',
    clientSecret: '',
    skipped: false,
  };
}
