import { join } from 'node:path';

import { cryptoService } from '@moltnet/crypto-service';
import {
  CliDivider,
  CliLogo,
  CliSpinner,
  CliStatusLine,
  CliStepHeader,
} from '@moltnet/design-system/cli';
import {
  exportSSHKey,
  type McpConfig,
  readConfig,
  writeConfig,
  writeMcpConfig,
} from '@themoltnet/sdk';
import { Box, Text, useApp } from 'ink';
import open from 'open';
import { useEffect, useReducer } from 'react';

import {
  type OnboardingStatus,
  pollUntil,
  startOnboarding,
  toErrorMessage,
} from './api.js';
import {
  exchangeManifestCode,
  lookupBotUser,
  writeGitConfig,
  writePem,
} from './github.js';
import { downloadSkills, toEnvPrefix, writeSettingsLocal } from './setup.js';
import {
  clearState,
  deriveProjectSlug,
  readState,
  writeState,
} from './state.js';

// ── Types ────────────────────────────────────────────────────────────────────

type StepKey =
  | 'keypair'
  | 'register'
  | 'githubApp'
  | 'gitSetup'
  | 'installation'
  | 'skills'
  | 'settings';

type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

type UIPhase =
  | 'identity'
  | 'github_app'
  | 'git_setup'
  | 'installation'
  | 'agent_setup'
  | 'done'
  | 'error';

interface UIState {
  phase: UIPhase;
  agentName: string;
  fingerprint?: string;
  appSlug?: string;
  serverStatus?: OnboardingStatus;
  manifestFormUrl?: string;
  errorMessage?: string;
  steps: Record<StepKey, StepStatus>;
}

type UIAction =
  | { type: 'step'; key: StepKey; status: StepStatus }
  | { type: 'phase'; phase: UIPhase }
  | { type: 'fingerprint'; fingerprint: string }
  | { type: 'appSlug'; appSlug: string }
  | { type: 'serverStatus'; status: OnboardingStatus }
  | { type: 'manifestFormUrl'; url: string }
  | { type: 'error'; message: string };

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'step':
      return {
        ...state,
        steps: { ...state.steps, [action.key]: action.status },
      };
    case 'phase':
      return { ...state, phase: action.phase };
    case 'fingerprint':
      return { ...state, fingerprint: action.fingerprint };
    case 'appSlug':
      return { ...state, appSlug: action.appSlug };
    case 'serverStatus':
      return { ...state, serverStatus: action.status };
    case 'manifestFormUrl':
      return { ...state, manifestFormUrl: action.url };
    case 'error':
      return { ...state, phase: 'error', errorMessage: action.message };
    default:
      return state;
  }
}

const initialSteps: Record<StepKey, StepStatus> = {
  keypair: 'pending',
  register: 'pending',
  githubApp: 'pending',
  gitSetup: 'pending',
  installation: 'pending',
  skills: 'pending',
  settings: 'pending',
};

// ── Phase result types ───────────────────────────────────────────────────────

interface IdentityResult {
  publicKey: string;
  fingerprint: string;
  workflowId: string;
  manifestFormUrl: string;
  clientId: string;
  clientSecret: string;
  skipped: boolean;
}

interface GithubAppResult {
  appSlug: string;
  pemPath: string;
  installationId: string;
  skipped: boolean;
}

interface InstallationResult {
  installationId: string;
  clientId: string;
  clientSecret: string;
}

// ── Phase functions ──────────────────────────────────────────────────────────

async function runIdentityPhase(opts: {
  apiUrl: string;
  agentName: string;
  configDir: string;
  projectSlug: string;
  dispatch: (a: UIAction) => void;
}): Promise<IdentityResult> {
  const { apiUrl, agentName, configDir, projectSlug, dispatch } = opts;
  const existingConfig = await readConfig(configDir);
  const existingState = await readState(projectSlug);

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
      fingerprint: existingConfig.keys.fingerprint,
      workflowId,
      manifestFormUrl: '',
      clientId: existingConfig.oauth2.client_id,
      clientSecret: existingConfig.oauth2.client_secret,
      skipped: true,
    };
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
      fingerprint: kp.fingerprint,
      agentName,
      phase: 'awaiting_github',
    },
    projectSlug,
  );
  dispatch({ type: 'step', key: 'register', status: 'done' });

  return {
    publicKey: kp.publicKey,
    fingerprint: kp.fingerprint,
    workflowId: started.workflowId,
    manifestFormUrl: started.manifestFormUrl,
    clientId: '',
    clientSecret: '',
    skipped: false,
  };
}

async function runGithubAppPhase(opts: {
  apiUrl: string;
  agentName: string;
  configDir: string;
  projectSlug: string;
  publicKey: string;
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
    fingerprint,
    workflowId,
    manifestFormUrl,
    dispatch,
  } = opts;

  const existingConfig = await readConfig(configDir);

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

async function runGitSetupPhase(opts: {
  configDir: string;
  repoDir: string;
  agentName: string;
  appSlug: string;
  dispatch: (a: UIAction) => void;
}): Promise<void> {
  const { configDir, repoDir, agentName, appSlug, dispatch } = opts;
  const existingConfig = await readConfig(configDir);

  if (existingConfig?.git?.config_path) {
    dispatch({ type: 'step', key: 'gitSetup', status: 'skipped' });
    return;
  }

  dispatch({ type: 'phase', phase: 'git_setup' });
  dispatch({ type: 'step', key: 'gitSetup', status: 'running' });
  await exportSSHKey({ configDir });
  const botUser = await lookupBotUser(appSlug);
  writeGitConfig({ cwd: repoDir, name: agentName, email: botUser.email });
  dispatch({ type: 'step', key: 'gitSetup', status: 'done' });
}

async function runInstallationPhase(opts: {
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
      clientId: existingConfig.oauth2.client_id,
      clientSecret: existingConfig.oauth2.client_secret,
    };
  }

  dispatch({ type: 'phase', phase: 'installation' });
  dispatch({ type: 'step', key: 'installation', status: 'running' });
  await open(`https://github.com/apps/${appSlug}/installations/new`);

  const result = await pollUntil(apiUrl, workflowId, ['completed'], (status) =>
    dispatch({ type: 'serverStatus', status }),
  );

  dispatch({ type: 'step', key: 'installation', status: 'done' });
  return {
    installationId: '',
    clientId: result.clientId ?? '',
    clientSecret: result.clientSecret ?? '',
  };
}

async function runAgentSetupPhase(opts: {
  apiUrl: string;
  repoDir: string;
  configDir: string;
  agentName: string;
  publicKey: string;
  fingerprint: string;
  appSlug: string;
  pemPath: string;
  installationId: string;
  clientId: string;
  clientSecret: string;
  projectSlug: string;
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
    clientId,
    clientSecret,
    projectSlug,
    dispatch,
  } = opts;

  dispatch({ type: 'phase', phase: 'agent_setup' });
  const existingConfig = await readConfig(configDir);

  if (!existingConfig?.oauth2?.client_id && clientId) {
    await writeConfig(
      {
        identity_id: '',
        registered_at: new Date().toISOString(),
        oauth2: { client_id: clientId, client_secret: clientSecret },
        keys: { public_key: publicKey, private_key: '', fingerprint },
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

  await clearState(projectSlug);
}

// ── Component ────────────────────────────────────────────────────────────────

export interface InitAppProps {
  name: string;
  apiUrl: string;
  dir?: string;
}

export function InitApp({ name, apiUrl, dir = process.cwd() }: InitAppProps) {
  const { exit } = useApp();

  const [state, dispatch] = useReducer(uiReducer, {
    phase: 'identity',
    agentName: name,
    steps: initialSteps,
  });

  useEffect(() => {
    void (async () => {
      try {
        const configDir = join(dir, '.moltnet', name);
        const projectSlug = await deriveProjectSlug(dir);

        const identity = await runIdentityPhase({
          apiUrl,
          agentName: name,
          configDir,
          projectSlug,
          dispatch,
        });

        const githubApp = await runGithubAppPhase({
          apiUrl,
          agentName: name,
          configDir,
          projectSlug,
          publicKey: identity.publicKey,
          fingerprint: identity.fingerprint,
          workflowId: identity.workflowId,
          manifestFormUrl: identity.manifestFormUrl,
          dispatch,
        });

        await runGitSetupPhase({
          configDir,
          repoDir: dir,
          agentName: name,
          appSlug: githubApp.appSlug,
          dispatch,
        });

        const installation = await runInstallationPhase({
          apiUrl,
          configDir,
          workflowId: identity.workflowId,
          appSlug: githubApp.appSlug,
          dispatch,
        });

        await runAgentSetupPhase({
          apiUrl,
          repoDir: dir,
          configDir,
          agentName: name,
          publicKey: identity.publicKey,
          fingerprint: identity.fingerprint,
          appSlug: githubApp.appSlug,
          pemPath: githubApp.pemPath,
          installationId:
            installation.installationId || githubApp.installationId,
          clientId: installation.clientId || identity.clientId,
          clientSecret: installation.clientSecret || identity.clientSecret,
          projectSlug,
          dispatch,
        });

        dispatch({ type: 'phase', phase: 'done' });
        setTimeout(() => exit(), 800);
      } catch (err) {
        dispatch({ type: 'error', message: toErrorMessage(err) });
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    phase,
    agentName,
    fingerprint,
    appSlug,
    serverStatus,
    manifestFormUrl,
    errorMessage,
    steps,
  } = state;

  if (phase === 'error') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <CliLogo />
        <Text color="red">
          {'Setup failed: ' + (errorMessage ?? 'unknown error')}
        </Text>
        <Text dimColor>Run again to resume from where you left off.</Text>
      </Box>
    );
  }

  if (phase === 'done') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <CliLogo />
        <Text color="green">LeGreffier setup complete!</Text>
        <Text dimColor>
          {'Agent "' + agentName + '" is ready for accountable commits.'}
        </Text>
      </Box>
    );
  }

  const githubAppSpinnerLabel =
    serverStatus === 'awaiting_installation'
      ? 'GitHub App created, waiting for installation…'
      : 'Waiting for GitHub App creation (browser opened)…';

  const installationSpinnerLabel =
    serverStatus === 'completed'
      ? 'Installation confirmed, finalising…'
      : 'Waiting for GitHub App installation…';

  return (
    <Box flexDirection="column" paddingY={1}>
      <CliLogo />
      <Text dimColor>{'API: ' + apiUrl}</Text>

      <CliStepHeader n={1} total={4} label="Identity" />
      <CliStatusLine
        label="Generate Ed25519 keypair"
        status={steps.keypair}
        detail={steps.keypair === 'done' ? fingerprint : undefined}
      />
      <CliStatusLine label="Register on MoltNet" status={steps.register} />

      <CliStepHeader n={2} total={4} label="GitHub App" />
      {steps.githubApp === 'running' ? (
        <Box flexDirection="column">
          <CliSpinner label={githubAppSpinnerLabel} />
          {manifestFormUrl ? (
            <Text dimColor>
              {'  If browser did not open: ' + manifestFormUrl}
            </Text>
          ) : null}
        </Box>
      ) : (
        <CliStatusLine
          label="Create GitHub App"
          status={steps.githubApp}
          detail={appSlug ?? undefined}
        />
      )}

      <CliStepHeader n={3} total={4} label="Git identity" />
      <CliStatusLine
        label="Export SSH keys + configure git"
        status={steps.gitSetup}
      />

      <CliStepHeader n={4} total={4} label="Finalise" />
      {steps.installation === 'running' ? (
        <CliSpinner label={installationSpinnerLabel} />
      ) : (
        <CliStatusLine
          label="GitHub App installation"
          status={steps.installation}
        />
      )}
      <CliStatusLine label="Download skills" status={steps.skills} />
      <CliStatusLine
        label="Write settings.local.json"
        status={steps.settings}
      />

      <CliDivider />
    </Box>
  );
}
