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
import React, { useEffect, useReducer, useRef, useState } from 'react';

import { toErrorMessage } from './api.js';
import { runAgentSetupPhase } from './phases/agentSetup.js';
import { runGithubAppPhase } from './phases/githubApp.js';
import { runGitSetupPhase } from './phases/gitSetup.js';
import { runIdentityPhase } from './phases/identity.js';
import { runInstallationPhase } from './phases/installation.js';
import { AgentSelect } from './ui/AgentSelect.js';
import { initialSteps, uiReducer } from './ui/reducer.js';
import type { AgentType, UIPhase, UIState } from './ui/types.js';

export interface InitAppProps {
  name: string;
  agent?: AgentType;
  apiUrl: string;
  dir?: string;
}

// ── Phase renderers ──────────────────────────────────────────────────────────

const WORK_PHASES: UIPhase[] = [
  'identity',
  'github_app',
  'git_setup',
  'installation',
  'agent_setup',
];

function isFuturePhase(current: UIPhase, target: UIPhase): boolean {
  return WORK_PHASES.indexOf(target) > WORK_PHASES.indexOf(current);
}

function DisclaimerPhase({
  selectedAgent,
  onAccept,
  onSelectAgent,
  onReject,
}: {
  selectedAgent: AgentType | null;
  onAccept: () => void;
  onSelectAgent: () => void;
  onReject: () => void;
}) {
  return (
    <Box flexDirection="column" paddingY={1}>
      <CliHero animated={true} />
      <CliDisclaimer
        onAccept={selectedAgent ? onAccept : onSelectAgent}
        onReject={onReject}
      />
    </Box>
  );
}

function AgentSelectPhase({
  onSelect,
}: {
  onSelect: (agent: AgentType) => void;
}) {
  return (
    <Box flexDirection="column" paddingY={1}>
      <CliHero />
      <AgentSelect onSelect={onSelect} />
    </Box>
  );
}

function ErrorPhase({ message }: { message?: string }) {
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
          {'✗  Setup failed: ' + (message ?? 'unknown error')}
        </Text>
      </Box>
      <Text color={cliTheme.color.muted}>
        {'  '}Run again to resume from where you left off.
      </Text>
    </Box>
  );
}

function DonePhase({ summary }: { summary?: UIState['summary'] }) {
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

function ProgressPhase({
  state,
  name,
  showManifestFallback,
  showInstallFallback,
}: {
  state: UIState;
  name: string;
  showManifestFallback: boolean;
  showInstallFallback: boolean;
}) {
  const {
    phase,
    fingerprint,
    appSlug,
    serverStatus,
    manifestFormUrl,
    installationUrl,
    steps,
  } = state;

  const future = (p: UIPhase) => isFuturePhase(phase, p);

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
      <Text color={cliTheme.color.muted}>{'  API: ' + state.agentName}</Text>

      <CliStepHeader n={1} total={4} label="Identity" />
      <Box flexDirection="column">
        <CliStatusLine
          label="Generate Ed25519 keypair"
          status={future('identity') ? 'pending' : steps.keypair}
          detail={
            steps.keypair === 'done' || steps.keypair === 'skipped'
              ? fingerprint
              : undefined
          }
        />
        <CliStatusLine
          label="Register on MoltNet"
          status={future('identity') ? 'pending' : steps.register}
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
            status={future('github_app') ? 'pending' : steps.githubApp}
            detail={appSlug ?? undefined}
          />
        )}
      </Box>

      <CliStepHeader n={3} total={4} label="Git identity" />
      <CliStatusLine
        label="Export SSH keys + configure git"
        status={future('git_setup') ? 'pending' : steps.gitSetup}
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
            status={future('installation') ? 'pending' : steps.installation}
          />
        )}
        <CliStatusLine
          label="Download skills"
          status={future('installation') ? 'pending' : steps.skills}
        />
        <CliStatusLine
          label="Write settings.local.json"
          status={future('installation') ? 'pending' : steps.settings}
        />
      </Box>

      <CliDivider />
    </Box>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function InitApp({
  name,
  agent: agentProp,
  apiUrl,
  dir = process.cwd(),
}: InitAppProps) {
  const { exit } = useApp();

  const [state, dispatch] = useReducer(uiReducer, {
    phase: 'disclaimer',
    agentName: name,
    steps: initialSteps,
  });

  const [accepted, setAccepted] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AgentType | null>(
    agentProp ?? null,
  );

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

        const identity = await runIdentityPhase({
          apiUrl,
          agentName: name,
          configDir,
          dispatch,
        });

        const githubApp = await runGithubAppPhase({
          apiUrl,
          agentName: name,
          configDir,
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

  const { phase } = state;

  const renderPhase: Partial<Record<UIPhase, () => React.ReactElement>> = {
    disclaimer: () => (
      <DisclaimerPhase
        selectedAgent={selectedAgent}
        onAccept={() => setAccepted(true)}
        onSelectAgent={() => dispatch({ type: 'phase', phase: 'agent_select' })}
        onReject={() => exit()}
      />
    ),
    agent_select: () => (
      <AgentSelectPhase
        onSelect={(agent) => {
          setSelectedAgent(agent);
          setAccepted(true);
        }}
      />
    ),
    error: () => <ErrorPhase message={state.errorMessage} />,
    done: () => <DonePhase summary={state.summary} />,
  };

  const renderer = renderPhase[phase];
  if (renderer) return renderer();

  // All work phases (identity → agent_setup) share the progress view
  return (
    <ProgressPhase
      state={state}
      name={name}
      showManifestFallback={showManifestFallback}
      showInstallFallback={showInstallFallback}
    />
  );
}
