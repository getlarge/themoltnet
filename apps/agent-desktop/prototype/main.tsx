/**
 * PROTOTYPE HARNESS — not part of the desktop app.
 *
 * Mounts `RunCenterApp` against fixture data and an in-memory
 * `RunCenterActions`. Scenario, screen, route and theme are read from the URL
 * so every screenshot in the review is reproducible:
 *
 *   ?scenario=populated&screen=runs&route=list
 *   ?scenario=populated&screen=runs&route=compose&preset=preset-review
 *   ?scenario=run-failed&screen=runs&route=detail&run=run_01k6xr72jd5h0vte
 *   ?scenario=runtime-drift&screen=runtimes&theme=light
 */
import '../src/styles.css';
import '../src/run-center/run-center.css';

import { MoltThemeProvider } from '@themoltnet/design-system';
import { StrictMode, useCallback, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
  createFixtureActions,
  FIXTURE_INVALID_CANDIDATE,
  FIXTURE_NOW,
  scenarioData,
  type ScenarioId,
} from '../src/run-center/fixtures.js';
import {
  RunCenterApp,
  type RunCenterScreen,
  type RunsRoute,
} from '../src/run-center/RunCenterApp.js';
import type { RunCenterData } from '../src/run-center/types.js';

const params = new URLSearchParams(window.location.search);
const scenario = (params.get('scenario') ?? 'populated') as ScenarioId;
const screen = (params.get('screen') ?? 'runs') as RunCenterScreen;
const theme = params.get('theme') === 'light' ? 'light' : 'dark';
const liveClock = params.get('clock') === 'live';

function initialRoute(): RunsRoute {
  const route = params.get('route');
  if (route === 'compose')
    return { kind: 'compose', presetId: params.get('preset') };
  if (route === 'detail' && params.get('run'))
    return { kind: 'detail', runId: params.get('run') as string };
  return { kind: 'list' };
}

function Harness() {
  const [data, setData] = useState<RunCenterData>(() =>
    scenarioData(scenario),
  );
  const getData = useCallback(() => data, [data]);
  const actions = useMemo(
    () =>
      createFixtureActions(getData, setData, {
        packageCandidate:
          params.get('package') === 'missing'
            ? FIXTURE_INVALID_CANDIDATE
            : undefined,
      }),
    [getData],
  );

  return (
    <RunCenterApp
      data={data}
      actions={actions}
      now={liveClock ? Date.now() : FIXTURE_NOW}
      initialScreen={screen}
      initialRunsRoute={initialRoute()}
    />
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('prototype root is missing');

createRoot(root).render(
  <StrictMode>
    <MoltThemeProvider mode={theme}>
      <Harness />
    </MoltThemeProvider>
  </StrictMode>,
);
