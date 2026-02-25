import { cryptoService } from '@moltnet/crypto-service';
import {
  CliDivider,
  CliLogo,
  CliSpinner,
  CliStatusLine,
  CliStepHeader,
} from '@moltnet/design-system/cli';
import {
  buildMcpConfig,
  exportSSHKey,
  getConfigDir,
  readConfig,
  writeConfig,
  writeMcpConfig,
} from '@themoltnet/sdk';
import { Box, Text, useApp } from 'ink';
import open from 'open';
import { useCallback, useEffect, useState } from 'react';

import { pollUntil, startOnboarding } from './api.js';
import {
  exchangeManifestCode,
  lookupBotUser,
  writeGitConfig,
  writePem,
} from './github.js';
import { downloadSkills, writeSettingsLocal } from './setup.js';
import {
  clearState,
  deriveProjectSlug,
  readState,
  writeState,
} from './state.js';

type StepKey =
  | 'keypair'
  | 'register'
  | 'githubApp'
  | 'gitSetup'
  | 'installation'
  | 'skills'
  | 'settings';

type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

interface AppState {
  phase:
    | 'identity'
    | 'github_app'
    | 'git_setup'
    | 'installation'
    | 'agent_setup'
    | 'done'
    | 'error';
  agentName: string;
  fingerprint?: string;
  appSlug?: string;
  errorMessage?: string;
  steps: Record<StepKey, StepStatus>;
}

export interface InitAppProps {
  name: string;
  apiUrl: string;
  dir?: string;
}

export function InitApp({ name, apiUrl, dir = process.cwd() }: InitAppProps) {
  const { exit } = useApp();

  const [state, setState] = useState<AppState>({
    phase: 'identity',
    agentName: name,
    steps: {
      keypair: 'pending',
      register: 'pending',
      githubApp: 'pending',
      gitSetup: 'pending',
      installation: 'pending',
      skills: 'pending',
      settings: 'pending',
    },
  });

  const setStep = useCallback((key: StepKey, status: StepStatus) => {
    setState((s) => ({ ...s, steps: { ...s.steps, [key]: status } }));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const configDir = getConfigDir();
        const projectSlug = await deriveProjectSlug(dir);
        const existingConfig = await readConfig(configDir);
        const existingState = await readState(projectSlug);

        let publicKey: string;
        let fingerprint: string;
        let workflowId: string;
        let clientId: string;
        let clientSecret: string;

        // ── Phase 1: Identity ────────────────────────────────────────────────
        if (
          existingConfig?.keys?.public_key &&
          existingConfig?.oauth2?.client_id
        ) {
          setStep('keypair', 'skipped');
          setStep('register', 'skipped');
          publicKey = existingConfig.keys.public_key;
          fingerprint = existingConfig.keys.fingerprint;
          clientId = existingConfig.oauth2.client_id;
          clientSecret = existingConfig.oauth2.client_secret;
          setState((s) => ({ ...s, fingerprint }));

          if (existingState?.workflowId && !existingConfig.github?.app_id) {
            workflowId = existingState.workflowId;
          } else {
            workflowId = '';
          }
        } else {
          setStep('keypair', 'running');
          const kp = await cryptoService.generateKeyPair();
          publicKey = kp.publicKey;
          fingerprint = kp.fingerprint;
          setState((s) => ({ ...s, fingerprint }));
          setStep('keypair', 'done');

          setStep('register', 'running');
          const started = await startOnboarding(apiUrl, {
            publicKey,
            fingerprint,
            agentName: name,
          });
          workflowId = started.workflowId;
          await writeState(
            {
              workflowId,
              publicKey,
              fingerprint,
              agentName: name,
              phase: 'awaiting_github',
            },
            projectSlug,
          );
          setStep('register', 'done');

          setState((s) => ({ ...s, phase: 'github_app' }));
          setStep('githubApp', 'running');
          await open(started.manifestFormUrl);

          // Placeholders — filled from poll result below
          clientId = '';
          clientSecret = '';
        }

        // ── Phase 2: GitHub App ──────────────────────────────────────────────
        let appSlug: string;
        let pemPath: string;
        let installationId: string;

        if (existingConfig?.github?.app_id) {
          setStep('githubApp', 'skipped');
          appSlug = existingConfig.github.app_slug ?? '';
          pemPath = existingConfig.github.private_key_path;
          installationId = existingConfig.github.installation_id;
          setState((s) => ({ ...s, appSlug }));
        } else {
          setState((s) => ({ ...s, phase: 'github_app' }));
          setStep('githubApp', 'running');

          // Poll until github_code_ready (user has completed manifest form)
          const codeResult = await pollUntil(
            apiUrl,
            workflowId,
            ['github_code_ready', 'awaiting_installation', 'completed'],
            (status) => {
              if (status === 'github_code_ready') {
                setState((s) => ({ ...s, phase: 'github_app' }));
              }
            },
          );

          if (!codeResult.githubCode) {
            throw new Error('GitHub code not available in onboarding status');
          }

          const ghCreds = await exchangeManifestCode(codeResult.githubCode);
          appSlug = ghCreds.appSlug;
          setState((s) => ({ ...s, appSlug }));

          pemPath = await writePem(ghCreds.pem, ghCreds.appSlug, projectSlug);
          await writeState(
            {
              workflowId,
              publicKey,
              fingerprint,
              agentName: name,
              phase: 'awaiting_installation',
              appId: ghCreds.appId,
              appSlug: ghCreds.appSlug,
            },
            projectSlug,
          );

          // Store partial config so we can resume after crash
          installationId = '';
          setStep('githubApp', 'done');
          setState((s) => ({ ...s, phase: 'git_setup' }));
        }

        // ── Phase 3: Git identity ────────────────────────────────────────────
        setState((s) => ({ ...s, phase: 'git_setup' }));

        if (existingConfig?.git?.config_path) {
          setStep('gitSetup', 'skipped');
        } else {
          setStep('gitSetup', 'running');
          const { privatePath } = await exportSSHKey({ configDir });
          const botUser = await lookupBotUser(appSlug);
          writeGitConfig({ cwd: dir, name, email: botUser.email });
          setStep('gitSetup', 'done');
          void privatePath; // used via SDK config update
        }

        // ── Phase 4: Installation polling ────────────────────────────────────
        setState((s) => ({ ...s, phase: 'installation' }));

        if (existingConfig?.github?.installation_id) {
          setStep('installation', 'skipped');
          installationId = existingConfig.github.installation_id;
        } else {
          setStep('installation', 'running');
          // Open GitHub App installation page (if we have appSlug)
          if (appSlug) {
            await open(`https://github.com/apps/${appSlug}/installations/new`);
          }
          // Poll until completed — may take minutes
          const completedResult = await pollUntil(
            apiUrl,
            workflowId,
            ['completed'],
            undefined,
          );

          // After completion, server exposes clientId/clientSecret
          if (completedResult.clientId) {
            clientId = completedResult.clientId;
            clientSecret = completedResult.clientSecret ?? '';
          }
          installationId = '';
          setStep('installation', 'done');
        }

        // ── Phase 5: Agent setup ─────────────────────────────────────────────
        setState((s) => ({ ...s, phase: 'agent_setup' }));

        // Write moltnet.json config if not already registered
        if (!existingConfig?.oauth2?.client_id && clientId) {
          const kp = await cryptoService.generateKeyPair(); // placeholder if needed
          void kp;
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
                app_id: existingState?.appId ?? '',
                app_slug: appSlug,
                installation_id: installationId,
                private_key_path: pemPath,
              },
            },
            configDir,
          );
        }

        // Write .mcp.json
        if (clientId) {
          const mcpConfig = buildMcpConfig(apiUrl, { clientId, clientSecret });
          mcpConfig.mcpServers = {
            [name]: mcpConfig.mcpServers.moltnet,
          } as typeof mcpConfig.mcpServers;
          await writeMcpConfig(mcpConfig, dir);
        }

        // Download skills
        setStep('skills', 'running');
        await downloadSkills(dir);
        setStep('skills', 'done');

        // Write .claude/settings.local.json
        setStep('settings', 'running');
        await writeSettingsLocal({
          repoDir: dir,
          appSlug,
          pemPath,
          installationId,
        });
        setStep('settings', 'done');

        // Clear resumption state
        await clearState(projectSlug);

        setState((s) => ({ ...s, phase: 'done' }));
        setTimeout(() => exit(), 800);
      } catch (err) {
        setState((s) => ({
          ...s,
          phase: 'error',
          errorMessage: err instanceof Error ? err.message : String(err),
        }));
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { phase, agentName, fingerprint, appSlug, errorMessage, steps } = state;

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

  return (
    <Box flexDirection="column" paddingY={1}>
      <CliLogo />

      <CliStepHeader n={1} total={4} label="Identity" />
      <CliStatusLine
        label="Generate Ed25519 keypair"
        status={steps.keypair}
        detail={steps.keypair === 'done' ? fingerprint : undefined}
      />
      <CliStatusLine label="Register on MoltNet" status={steps.register} />

      <CliStepHeader n={2} total={4} label="GitHub App" />
      {steps.githubApp === 'running' ? (
        <CliSpinner label="Waiting for GitHub App creation (browser opened)..." />
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
        <CliSpinner label="Waiting for GitHub App installation..." />
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
