import { homedir } from 'node:os';
import { join } from 'node:path';

import { cryptoService } from '@moltnet/crypto-service';
import {
  CliDisclaimer,
  CliDivider,
  CliHero,
  CliSpinner,
  CliStatusLine,
  CliStepHeader,
  CliSummaryBox,
  cliTheme,
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
import { useEffect, useReducer, useRef, useState } from 'react';

import {
  checkWorkflowLive,
  type OnboardingStatus,
  pollUntil,
  startOnboarding,
  toErrorMessage,
} from './api.js';
import {
  checkAppNameAvailable,
  exchangeManifestCode,
  lookupBotUser,
  suggestAppNames,
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
  | 'disclaimer'
  | 'identity'
  | 'github_app'
  | 'git_setup'
  | 'installation'
  | 'agent_setup'
  | 'done'
  | 'error';

interface UISummary {
  agentName: string;
  fingerprint: string;
  appSlug: string;
  apiUrl: string;
  mcpUrl: string;
}

interface UIState {
  phase: UIPhase;
  agentName: string;
  fingerprint?: string;
  appSlug?: string;
  serverStatus?: OnboardingStatus;
  manifestFormUrl?: string;
  installationUrl?: string;
  summary?: UISummary;
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
  | { type: 'installationUrl'; url: string }
  | { type: 'summary'; summary: UISummary }
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
    case 'installationUrl':
      return { ...state, installationUrl: action.url };
    case 'summary':
      return { ...state, summary: action.summary };
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
  privateKey: string;
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
  identityId: string;
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
    await clearState(projectSlug);
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

async function runGithubAppPhase(opts: {
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
  identityId: string;
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
    identityId,
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
    phase: 'disclaimer',
    agentName: name,
    steps: initialSteps,
  });

  // Disclaimer accepted flag — triggers the main flow
  const [accepted, setAccepted] = useState(false);

  // Delayed fallback URL visibility (2s after URL is set)
  const [showManifestFallback, setShowManifestFallback] = useState(false);
  const [showInstallFallback, setShowInstallFallback] = useState(false);
  const manifestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const installTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Watch for manifestFormUrl to be set, then show fallback after 2s
  useEffect(() => {
    if (state.manifestFormUrl) {
      manifestTimerRef.current = setTimeout(
        () => setShowManifestFallback(true),
        2000,
      );
      return () => {
        if (manifestTimerRef.current) clearTimeout(manifestTimerRef.current);
      };
    }
  }, [state.manifestFormUrl]);

  useEffect(() => {
    if (state.installationUrl) {
      installTimerRef.current = setTimeout(
        () => setShowInstallFallback(true),
        2000,
      );
      return () => {
        if (installTimerRef.current) clearTimeout(installTimerRef.current);
      };
    }
  }, [state.installationUrl]);

  useEffect(() => {
    if (!accepted) return;
    dispatch({ type: 'phase', phase: 'identity' });

    void (async () => {
      try {
        const configDir = join(dir, '.moltnet', name);
        const projectSlug = deriveProjectSlug(dir);

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
          privateKey: identity.privateKey,
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
          identityId: installation.identityId,
          clientId: installation.clientId || identity.clientId,
          clientSecret: installation.clientSecret || identity.clientSecret,
          projectSlug,
          dispatch,
        });

        const mcpUrl = apiUrl.replace('://api.', '://mcp.') + '/mcp';
        dispatch({
          type: 'summary',
          summary: {
            agentName: name,
            fingerprint: identity.fingerprint,
            appSlug: githubApp.appSlug,
            apiUrl,
            mcpUrl,
          },
        });
        dispatch({ type: 'phase', phase: 'done' });
        setTimeout(() => exit(), 3000);
      } catch (err) {
        dispatch({ type: 'error', message: toErrorMessage(err) });
      }
    })();
  }, [accepted]); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    phase,
    agentName,
    fingerprint,
    appSlug,
    serverStatus,
    manifestFormUrl,
    installationUrl,
    summary,
    errorMessage,
    steps,
  } = state;

  // ── Disclaimer ────────────────────────────────────────────────────────────
  if (phase === 'disclaimer') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <CliHero animated={true} />
        <CliDisclaimer
          onAccept={() => setAccepted(true)}
          onReject={() => {
            exit();
          }}
        />
      </Box>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <CliHero />
        <Box
          borderStyle="round"
          borderColor={cliTheme.color.error}
          paddingX={2}
          paddingY={1}
          marginBottom={1}
        >
          <Text color={cliTheme.color.error} bold>
            {'✗  Setup failed: ' + (errorMessage ?? 'unknown error')}
          </Text>
        </Box>
        <Text color={cliTheme.color.muted}>
          {'  '}Run again to resume from where you left off.
        </Text>
      </Box>
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <CliHero />
        {summary && (
          <CliSummaryBox
            agentName={summary.agentName}
            fingerprint={summary.fingerprint}
            appSlug={summary.appSlug}
            apiUrl={summary.apiUrl}
            mcpUrl={summary.mcpUrl}
          />
        )}
      </Box>
    );
  }

  // ── Determine which phases are active/future for dimming ──────────────────
  const PHASE_ORDER: UIPhase[] = [
    'identity',
    'github_app',
    'git_setup',
    'installation',
    'agent_setup',
  ];
  const currentPhaseIndex = PHASE_ORDER.indexOf(phase);
  const isFuture = (p: UIPhase) => PHASE_ORDER.indexOf(p) > currentPhaseIndex;

  const githubAppSpinnerLabel =
    serverStatus === 'awaiting_installation'
      ? 'GitHub App created, waiting for installation…'
      : `Waiting for GitHub App creation (app name: "${agentName}")…`;

  const installationSpinnerLabel =
    serverStatus === 'completed'
      ? 'Installation confirmed, finalising…'
      : 'Waiting for GitHub App installation…';

  return (
    <Box flexDirection="column" paddingY={1}>
      <CliHero />
      <Text color={cliTheme.color.muted}>{'  API: ' + apiUrl}</Text>

      <CliStepHeader n={1} total={4} label="Identity" />
      <Box flexDirection="column">
        <CliStatusLine
          label="Generate Ed25519 keypair"
          status={isFuture('identity') ? 'pending' : steps.keypair}
          detail={
            steps.keypair === 'done' || steps.keypair === 'skipped'
              ? fingerprint
              : undefined
          }
        />
        <CliStatusLine
          label="Register on MoltNet"
          status={isFuture('identity') ? 'pending' : steps.register}
        />
      </Box>

      <CliStepHeader n={2} total={4} label="GitHub App" />
      <Box flexDirection="column">
        {steps.githubApp === 'running' ? (
          <Box flexDirection="column">
            <CliSpinner label={githubAppSpinnerLabel} />
            {showManifestFallback && manifestFormUrl ? (
              <Text color={cliTheme.color.muted}>
                {'  → '}
                <Text color={cliTheme.color.accent}>{manifestFormUrl}</Text>
              </Text>
            ) : null}
          </Box>
        ) : (
          <CliStatusLine
            label="Create GitHub App"
            status={isFuture('github_app') ? 'pending' : steps.githubApp}
            detail={appSlug ?? undefined}
          />
        )}
      </Box>

      <CliStepHeader n={3} total={4} label="Git identity" />
      <CliStatusLine
        label="Export SSH keys + configure git"
        status={isFuture('git_setup') ? 'pending' : steps.gitSetup}
      />

      <CliStepHeader n={4} total={4} label="Finalise" />
      <Box flexDirection="column">
        {steps.installation === 'running' ? (
          <Box flexDirection="column">
            <CliSpinner label={installationSpinnerLabel} />
            {showInstallFallback && installationUrl ? (
              <Text color={cliTheme.color.muted}>
                {'  → '}
                <Text color={cliTheme.color.accent}>{installationUrl}</Text>
              </Text>
            ) : null}
          </Box>
        ) : (
          <CliStatusLine
            label="GitHub App installation"
            status={isFuture('installation') ? 'pending' : steps.installation}
          />
        )}
        <CliStatusLine
          label="Download skills"
          status={isFuture('installation') ? 'pending' : steps.skills}
        />
        <CliStatusLine
          label="Write settings.local.json"
          status={isFuture('installation') ? 'pending' : steps.settings}
        />
      </Box>

      <CliDivider />
    </Box>
  );
}
