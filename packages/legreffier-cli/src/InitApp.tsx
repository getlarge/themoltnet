import { join } from 'node:path';

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
import { Box, Text, useApp } from 'ink';
import { useEffect, useReducer, useRef, useState } from 'react';

import { toErrorMessage } from './api.js';
import { runAgentSetupPhase } from './phases/agentSetup.js';
import { runGithubAppPhase } from './phases/githubApp.js';
import { runGitSetupPhase } from './phases/gitSetup.js';
import { runIdentityPhase } from './phases/identity.js';
import { runInstallationPhase } from './phases/installation.js';
import { deriveProjectSlug } from './state.js';
import { initialSteps, uiReducer } from './ui/reducer.js';
import type { UIPhase } from './ui/types.js';

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

  const [accepted, setAccepted] = useState(false);

  // Delayed fallback URL visibility (2s after URL is set)
  const [showManifestFallback, setShowManifestFallback] = useState(false);
  const [showInstallFallback, setShowInstallFallback] = useState(false);
  const manifestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const installTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    fingerprint,
    appSlug,
    serverStatus,
    manifestFormUrl,
    installationUrl,
    summary,
    errorMessage,
    steps,
  } = state;

  // ── Disclaimer ──────────────────────────────────────────────────────────────
  if (phase === 'disclaimer') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <CliHero animated={true} />
        <CliDisclaimer
          onAccept={() => setAccepted(true)}
          onReject={() => exit()}
        />
      </Box>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────
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

  // ── Done ────────────────────────────────────────────────────────────────────
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

  // ── Active phases ────────────────────────────────────────────────────────────
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
      : `Waiting for GitHub App creation (app name: "${name}")…`;

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
