import {
  Badge,
  Button,
  Container,
  Stack,
  Text,
  useThemeMode,
} from '@themoltnet/design-system';
import { useEffect, useState } from 'react';

import {
  DEMO_LABELS,
  type TaskDetailScenarioId,
  taskDetailScenarios,
} from '../src/fixtures/task-detail';
import { TaskDetailView } from '../src/index';

/**
 * Renders the Console's task detail view from the synthetic fixtures.
 *
 * URL parameters (all optional), so a capture can be reproduced exactly:
 *   view=task-detail            select this demo
 *   scenario=<id>               accepted | queued | running | failed |
 *                               unknown-output | no-knowledge | long-content
 *   presentation=1              compact identifiers, hide operator panels
 *   chrome=0                    hide the harness toolbar (for captures)
 *   theme=dark|light
 */
function readParams() {
  const params = new URLSearchParams(window.location.search);
  const scenario = params.get('scenario') as TaskDetailScenarioId | null;
  return {
    scenario:
      scenario && scenario in taskDetailScenarios ? scenario : 'accepted',
    presentation: params.get('presentation') === '1',
    chrome: params.get('chrome') !== '0',
    theme: params.get('theme'),
  } as const;
}

function writeParams(scenario: string, presentation: boolean) {
  const params = new URLSearchParams(window.location.search);
  params.set('view', 'task-detail');
  params.set('scenario', scenario);
  if (presentation) params.set('presentation', '1');
  else params.delete('presentation');
  window.history.replaceState(null, '', `?${params.toString()}`);
}

export function TaskDetailDemo() {
  const initial = readParams();
  const { resolvedMode, setMode } = useThemeMode();
  const [scenarioId, setScenarioId] = useState<TaskDetailScenarioId>(
    initial.scenario,
  );
  const [presentation, setPresentation] = useState(initial.presentation);
  const scenario = taskDetailScenarios[scenarioId];

  useEffect(() => {
    if (initial.theme === 'light' || initial.theme === 'dark') {
      setMode(initial.theme);
    }
    // Apply the URL theme once on load; the toolbar owns it afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    writeParams(scenarioId, presentation);
  }, [scenarioId, presentation]);

  const label = (id: string | null) => (id ? (DEMO_LABELS[id] ?? id) : null);

  return (
    // xl sits within the Console's own content width (1128px beside the
    // sidebar on a 1440px screen, up to 1392px on wider ones).
    <Container maxWidth="xl">
      <Stack gap={5} style={{ padding: '2rem 0 4rem' }}>
        {initial.chrome ? (
          <Stack gap={3}>
            <Stack direction="row" justify="space-between" align="center" wrap>
              <Text variant="h4">Task detail · fixture harness</Text>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setMode(resolvedMode === 'dark' ? 'light' : 'dark')
                }
              >
                {resolvedMode === 'dark' ? 'Light' : 'Dark'} theme
              </Button>
            </Stack>
            <Stack direction="row" gap={2} wrap>
              {Object.values(taskDetailScenarios).map((option) => (
                <Button
                  key={option.id}
                  size="sm"
                  variant={option.id === scenarioId ? 'primary' : 'secondary'}
                  aria-pressed={option.id === scenarioId}
                  onClick={() => setScenarioId(option.id)}
                >
                  {option.label}
                </Button>
              ))}
              <Button
                size="sm"
                variant={presentation ? 'accent' : 'secondary'}
                aria-pressed={presentation}
                onClick={() => setPresentation((value) => !value)}
              >
                Presentation mode
              </Button>
            </Stack>
          </Stack>
        ) : null}

        <TaskDetailView
          key={scenarioId}
          task={scenario.task}
          attempts={scenario.attempts}
          knowledge={{
            entries: scenario.knowledge,
            total: scenario.knowledge.length,
            status: 'ready',
          }}
          presentation={presentation}
          notice={
            <Stack direction="row" align="center" gap={2} wrap>
              <Badge>Illustrative example</Badge>
              <Text variant="caption" color="muted">
                Synthetic data rendered with the Console’s task components
              </Text>
            </Stack>
          }
          renderTeamLabel={presentation ? label : undefined}
          renderDiaryLabel={presentation ? label : undefined}
          renderActorLabel={presentation ? label : undefined}
          onOpenAttempt={() => undefined}
          onOpenRuntimeProfile={() => undefined}
          onOpenDiary={() => undefined}
        />
      </Stack>
    </Container>
  );
}
