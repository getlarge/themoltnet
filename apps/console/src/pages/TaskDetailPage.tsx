import {
  getTaskOptions,
  listTaskAttemptsOptions,
} from '@moltnet/api-client/query';
import {
  TaskActionPanel,
  TaskAttemptsTable,
  TaskDetailHeader,
  TaskInputViewer,
  TaskRefsList,
} from '@moltnet/task-ui';
import { useQuery } from '@tanstack/react-query';
import { Card, Stack, Text, useTheme } from '@themoltnet/design-system';
import { Link, useLocation } from 'wouter';

import { getApiClient } from '../api.js';

export function TaskDetailPage({ id }: { id: string }) {
  const theme = useTheme();
  const [, navigate] = useLocation();
  const taskQuery = useQuery({
    ...getTaskOptions({
      client: getApiClient(),
      path: { id },
    }),
    refetchInterval: (query) =>
      query.state.data &&
      ['queued', 'dispatched', 'running'].includes(query.state.data.status)
        ? 5_000
        : false,
  });
  const attemptsQuery = useQuery({
    ...listTaskAttemptsOptions({
      client: getApiClient(),
      path: { id },
    }),
    refetchInterval: (query) =>
      query.state.data?.some((attempt) =>
        ['claimed', 'running'].includes(attempt.status),
      )
        ? 5_000
        : false,
  });

  if (taskQuery.isLoading) return <Text color="muted">Loading task…</Text>;

  if (taskQuery.error || !taskQuery.data) {
    return (
      <Card style={{ padding: '1.5rem' }}>
        <Text color="muted">Failed to load this task.</Text>
      </Card>
    );
  }

  const task = taskQuery.data;
  const attempts = attemptsQuery.data ?? [];
  const latestAttempt = attempts.at(-1) ?? null;

  return (
    <Stack gap={6}>
      <Link
        href="/tasks"
        style={{ color: theme.color.text.muted, textDecoration: 'none' }}
      >
        &larr; Tasks
      </Link>

      <TaskDetailHeader
        task={task}
        onOpenConsole={(selected) => {
          if (selected.consoleUrl) window.open(selected.consoleUrl, '_blank');
        }}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 360px)',
          gap: theme.spacing[5],
          alignItems: 'start',
        }}
      >
        <Stack gap={5}>
          <Card variant="surface" padding="md">
            <TaskInputViewer input={task.input} inputCid={task.inputCid} />
          </Card>

          <Card variant="surface" padding="md">
            <Stack gap={3}>
              <Text variant="h3" style={{ margin: 0 }}>
                References
              </Text>
              <TaskRefsList
                refs={task.references}
                onOpenTaskRef={(ref) => {
                  if (ref.taskId) navigate(`/tasks/${ref.taskId}`);
                }}
                onOpenExternalRef={(ref) => {
                  if (ref.external?.url)
                    window.open(ref.external.url, '_blank');
                }}
              />
            </Stack>
          </Card>

          <Card variant="surface" padding="md">
            <Stack gap={3}>
              <Text variant="h3" style={{ margin: 0 }}>
                Attempts
              </Text>
              <TaskAttemptsTable
                attempts={attempts}
                onSelectAttempt={(attempt) =>
                  navigate(`/tasks/${task.id}/attempts/${attempt.attemptN}`)
                }
              />
            </Stack>
          </Card>
        </Stack>

        <TaskActionPanel task={task} selectedAttempt={latestAttempt} />
      </div>
    </Stack>
  );
}
