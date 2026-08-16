import {
  getTaskOptions,
  listDiaryEntriesOptions,
  listTaskAttemptsOptions,
} from '@moltnet/api-client/query';
import {
  TaskActionPanel,
  TaskAttemptsTable,
  TaskDetailHeader,
  TaskExecutionRecord,
  TaskInputViewer,
  TaskRefsList,
} from '@moltnet/task-ui';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  InlineNotice,
  PageHeader,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { Link, useLocation } from 'wouter';

import { getApiClient } from '../api.js';
import { ManageTaskGrants } from '../components/tasks/ManageTaskGrants.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useTeam } from '../team/useTeam.js';

export function TaskDetailPage({ id }: { id: string }) {
  const theme = useTheme();
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const { selectedTeam } = useTeam();
  const taskQuery = useQuery({
    ...getTaskOptions({
      client: getApiClient(),
      path: { id },
    }),
    refetchInterval: (query) =>
      query.state.data &&
      ['waiting', 'queued', 'dispatched', 'running'].includes(
        query.state.data.status,
      )
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
  const task = taskQuery.data;
  const knowledgeQuery = useQuery({
    ...listDiaryEntriesOptions({
      client: getApiClient(),
      path: { diaryId: task?.diaryId ?? '' },
      query: {
        limit: 10,
        offset: 0,
        tags: [`task:id:${id}`],
      },
    }),
    enabled: Boolean(task?.diaryId),
  });

  if (taskQuery.isLoading) return <Text color="muted">Loading task…</Text>;

  if (taskQuery.error || !task) {
    return (
      <Card style={{ padding: '1.5rem' }}>
        <Text color="muted">Failed to load this task.</Text>
      </Card>
    );
  }

  const attempts = attemptsQuery.data ?? [];
  const latestAttempt = attempts.at(-1) ?? null;
  const recordAttempt = task.acceptedAttemptN
    ? (attempts.find((attempt) => attempt.attemptN === task.acceptedAttemptN) ??
      latestAttempt)
    : latestAttempt;

  return (
    <Stack gap={6}>
      <PageHeader
        eyebrow="Task Engine"
        title="Task execution"
        description="Inspect the durable contract and every authority decision attached to this task."
        backLink={
          <Link
            href="/tasks"
            style={{ color: theme.color.text.muted, textDecoration: 'none' }}
          >
            &larr; Task board
          </Link>
        }
      />

      <TaskDetailHeader
        task={task}
        onOpenConsole={(selected) => {
          if (selected.consoleUrl) window.open(selected.consoleUrl, '_blank');
        }}
      />

      {attemptsQuery.isLoading ? (
        <Card variant="surface" padding="md">
          <Text color="muted">Loading attempt evidence…</Text>
        </Card>
      ) : attemptsQuery.isError ? (
        <InlineNotice tone="warning" title="Attempt evidence unavailable">
          <Stack gap={3}>
            <Text>
              Claim, runtime, and result state cannot be verified until the
              attempt history is available.
            </Text>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void attemptsQuery.refetch()}
              style={{ alignSelf: 'flex-start' }}
            >
              Retry attempt evidence
            </Button>
          </Stack>
        </InlineNotice>
      ) : (
        <TaskExecutionRecord
          task={task}
          attempt={recordAttempt}
          knowledge={{
            count: task.diaryId ? (knowledgeQuery.data?.total ?? null) : 0,
            unavailable: knowledgeQuery.isError,
          }}
          attemptAction={
            recordAttempt ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  navigate(
                    `/tasks/${task.id}/attempts/${recordAttempt.attemptN}`,
                  )
                }
              >
                Inspect attempt
              </Button>
            ) : undefined
          }
          runtimeAction={
            recordAttempt?.runtimeProfileId ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/runtime/profiles')}
              >
                Open profile
              </Button>
            ) : undefined
          }
          knowledgeAction={
            task.diaryId ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/diaries/${task.diaryId}`)}
              >
                Open diary
              </Button>
            ) : undefined
          }
        />
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile
            ? 'minmax(0, 1fr)'
            : 'minmax(0, 1fr) minmax(260px, 360px)',
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
              {attemptsQuery.isError ? (
                <Text color="muted">Attempt history unavailable.</Text>
              ) : (
                <TaskAttemptsTable
                  attempts={attempts}
                  onSelectAttempt={(attempt) =>
                    navigate(`/tasks/${task.id}/attempts/${attempt.attemptN}`)
                  }
                />
              )}
            </Stack>
          </Card>
        </Stack>

        <TaskActionPanel task={task} selectedAttempt={latestAttempt} />
      </div>

      <ManageTaskGrants
        taskId={task.id}
        teamId={task.teamId}
        canManage={selectedTeam?.role === 'owner'}
      />
    </Stack>
  );
}
