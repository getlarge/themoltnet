/**
 * THESIS: The run is the subject; the server is the utility underneath it.
 *   Refuses the tray-app default where "start" is a form you refill every time
 *   and the machine's health is the headline.
 * OWN-WORLD: Inherited MoltNet control plane — matte void/surface/elevated
 *   layering, one-pixel rules, teal for coordination and live flow, amber for
 *   identity and attested fingerprints, JetBrains Mono for ids, hashes, task
 *   types and state. No card grids, no colored edges thicker than the rule.
 * STORY: I see what my agents are doing now, relaunch work I already trust,
 *   and visit the server only when it asks for me.
 * FIRST VIEWPORT: A title strip carrying live server state, a left rail of
 *   Runs / Server above saved presets, and a Runs pane that opens
 *   on live runs — each a full-width control surface with a teal state dot,
 *   the ordered profile chain, task types, claim count and Stop.
 * FORM: Operate; extension of the shipped agent-desktop world. Sidebar shell,
 *   chosen by the operator from a three-option probe over compact-panel and
 *   popover-plus-window alternatives.
 */
import {
  Badge,
  Logo,
  SideNavigation,
  type SideNavigationItem,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useCallback, useMemo, useState } from 'react';

import { ServerPanel } from '../App.js';
import { ProvidersView } from './ProvidersView.js';
import { providerActions } from './run-center-bridge.js';
import { RunsView } from './RunsView.js';
import type { RunCenterActions, RunCenterData } from './types.js';

export type RunCenterScreen = 'runs' | 'providers' | 'server';

/** Where the Runs pane is: the list, the composer, or one run's detail. */
export type RunsRoute =
  | { kind: 'list' }
  | { kind: 'compose'; presetId: string | null }
  | { kind: 'detail'; runId: string };

export interface RunCenterAppProps {
  data: RunCenterData;
  actions: RunCenterActions;
  /** Frozen clock for deterministic screenshots; defaults to the real one. */
  now?: number;
  initialScreen?: RunCenterScreen;
  initialRunsRoute?: RunsRoute;
  /** Refetch after a provider change, so readiness reflects the new key. */
  onProvidersChanged: () => void;
}

const SERVER_TONE: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'error' | 'default' }
> = {
  running: { label: 'Server running', variant: 'success' },
  update_available: { label: 'Update available', variant: 'warning' },
  starting: { label: 'Starting…', variant: 'default' },
  stopping: { label: 'Stopping…', variant: 'default' },
  stopped: { label: 'Server stopped', variant: 'default' },
  checking: { label: 'Checking…', variant: 'default' },
  needs_install: { label: 'Agent not installed', variant: 'warning' },
  installing: { label: 'Installing…', variant: 'default' },
  needs_trust: { label: 'Trust required', variant: 'warning' },
  removed: { label: 'Agent removed', variant: 'warning' },
  failed: { label: 'Server needs attention', variant: 'error' },
};

export function RunCenterApp({
  data,
  actions,
  now = Date.now(),
  initialScreen = 'runs',
  initialRunsRoute = { kind: 'list' },
  onProvidersChanged,
}: RunCenterAppProps) {
  const theme = useTheme();
  const [screen, setScreen] = useState<RunCenterScreen>(initialScreen);
  const [runsRoute, setRunsRoute] = useState<RunsRoute>(initialRunsRoute);

  const activeRuns = useMemo(
    () => data.runs.filter((run) => run.status === 'running'),
    [data.runs],
  );

  const openPreset = useCallback((presetId: string) => {
    setScreen('runs');
    setRunsRoute({ kind: 'compose', presetId });
  }, []);

  // A provider with no key is the most common reason a profile cannot run.
  const missingKeys = Object.values(data.providers).filter(
    (provider) => !provider.hasApiKey,
  ).length;
  const serverTone = SERVER_TONE[data.server.state] ?? SERVER_TONE.checking;
  const serverNeedsUser = ['needs_trust', 'needs_install', 'failed'].includes(
    data.server.state,
  );

  const navItems: SideNavigationItem[] = [
    {
      id: 'runs',
      label: 'Runs',
      href: '#runs',
      current: screen === 'runs',
      badge: activeRuns.length ? (
        <Badge variant="success">{activeRuns.length}</Badge>
      ) : undefined,
    },
    {
      id: 'providers',
      label: 'Providers',
      href: '#providers',
      current: screen === 'providers',
      badge: missingKeys ? (
        <Badge variant="warning">{missingKeys}</Badge>
      ) : undefined,
    },
    {
      id: 'server',
      label: 'Server',
      href: '#server',
      current: screen === 'server',
      badge: serverNeedsUser ? <Badge variant="warning">!</Badge> : undefined,
    },
  ];

  const presetItems: SideNavigationItem[] = data.presets.map((preset) => {
    const live = activeRuns.some((run) => run.presetName === preset.name);
    return {
      id: `preset-${preset.id}`,
      label: preset.name,
      href: `#preset-${preset.id}`,
      current:
        screen === 'runs' &&
        runsRoute.kind === 'compose' &&
        runsRoute.presetId === preset.id,
      badge: live ? (
        <span
          className="run-dot run-dot--live"
          role="img"
          aria-label="Running now"
        />
      ) : undefined,
    };
  });

  return (
    <div className="run-center">
      <header className="run-center__titlebar">
        <Stack direction="row" gap={3} align="center">
          <Logo size={22} />
          <Text as="span" variant="caption" weight="semibold">
            MoltNet Agent
          </Text>
        </Stack>
        <button
          type="button"
          className="run-center__server-chip"
          onClick={() => setScreen('server')}
          aria-label={`${serverTone.label}. Open the Server view.`}
        >
          <span
            className={`run-dot run-dot--${serverTone.variant}`}
            aria-hidden="true"
          />
          <Text as="span" variant="caption" color="secondary">
            {serverTone.label}
          </Text>
          {data.server.installedVersion ? (
            <Text as="span" variant="caption" color="muted" mono>
              {data.server.installedVersion}
            </Text>
          ) : null}
        </button>
      </header>

      <div className="run-center__body">
        <aside
          className="run-center__rail"
          style={{ borderRight: `1px solid ${theme.color.border.DEFAULT}` }}
        >
          <SideNavigation
            ariaLabel="Run Center"
            groups={[
              { id: 'primary', items: navItems },
              ...(presetItems.length
                ? [{ id: 'presets', label: 'Presets', items: presetItems }]
                : []),
            ]}
            onNavigate={(item, event) => {
              event.preventDefault();
              if (item.id.startsWith('preset-')) {
                openPreset(item.id.slice('preset-'.length));
                return;
              }
              setScreen(item.id as RunCenterScreen);
              if (item.id === 'runs') setRunsRoute({ kind: 'list' });
            }}
            footer={
              data.presets.length ? (
                <Text variant="caption" color="muted">
                  Presets open prefilled — nothing starts on its own.
                </Text>
              ) : null
            }
          />
        </aside>

        <main id="main-content" className="run-center__pane" tabIndex={-1}>
          {screen === 'runs' ? (
            <RunsView
              data={data}
              actions={actions}
              now={now}
              route={runsRoute}
              onRoute={setRunsRoute}
            />
          ) : null}
          {screen === 'providers' ? (
            <ProvidersView
              providers={data.providers}
              actions={providerActions}
              onChanged={onProvidersChanged}
            />
          ) : null}
          {screen === 'server' ? <ServerPanel /> : null}
        </main>
      </div>
    </div>
  );
}
