import {
  getTaskOptions,
  listDiaryEntriesOptions,
  listTaskAttemptsOptions,
} from '@moltnet/api-client/query';
import { TaskDetailView, type TaskKnowledgeEntry } from '@moltnet/task-ui';
import { useQuery } from '@tanstack/react-query';
import { Card, Text, useTheme } from '@themoltnet/design-system';
import { Link, useLocation } from 'wouter';

import { getApiClient } from '../api.js';
import { ManageTaskGrants } from '../components/tasks/ManageTaskGrants.js';
import { useTeam } from '../team/useTeam.js';

export function TaskDetailPage({ id }: { id: string }) {
  const theme = useTheme();
  const [, navigate] = useLocation();
  const { selectedTeam, isLoading: isTeamLoading } = useTeam();
  const teamHeaders = selectedTeam
    ? { 'x-moltnet-team-id': selectedTeam.id }
    : undefined;
  const taskQuery = useQuery({
    ...getTaskOptions({
      client: getApiClient(),
      headers: teamHeaders,
      path: { id },
    }),
    enabled: Boolean(selectedTeam),
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
      headers: teamHeaders,
      path: { id },
    }),
    enabled: Boolean(selectedTeam),
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
      headers: teamHeaders,
      path: { diaryId: task?.diaryId ?? '' },
      query: {
        limit: 10,
        offset: 0,
        tags: [`task:id:${id}`],
      },
    }),
    enabled: Boolean(selectedTeam && task?.diaryId),
  });

  if (isTeamLoading || !selectedTeam || taskQuery.isLoading) {
    return <Text color="muted">Loading task…</Text>;
  }

  if (taskQuery.error || !task) {
    return (
      <Card style={{ padding: '1.5rem' }}>
        <Text color="muted">Failed to load this task.</Text>
      </Card>
    );
  }

  const knowledgeEntries: TaskKnowledgeEntry[] = (
    knowledgeQuery.data?.items ?? []
  ).map((entry) => ({
    id: entry.id,
    title: entry.title,
    entryType: entry.entryType,
    createdAt: entry.createdAt,
    content: entry.content,
    signed: Boolean(entry.contentSignature),
    tags: entry.tags,
  }));

  return (
    <TaskDetailView
      task={task}
      attempts={attemptsQuery.data ?? []}
      attemptsStatus={
        attemptsQuery.isLoading
          ? 'loading'
          : attemptsQuery.isError
            ? 'error'
            : 'ready'
      }
      knowledge={{
        entries: knowledgeEntries,
        total: knowledgeQuery.data?.total ?? null,
        status: knowledgeQuery.isError
          ? 'error'
          : knowledgeQuery.data
            ? 'ready'
            : 'loading',
      }}
      backLink={
        <Link
          href="/tasks"
          style={{ color: theme.color.text.muted, textDecoration: 'none' }}
        >
          &larr; Task board
        </Link>
      }
      renderEntryLink={(entry, children) => (
        <Link
          href={`/diaries/${task.diaryId}/entries/${entry.id}`}
          style={{ color: theme.color.text.DEFAULT }}
        >
          {children}
        </Link>
      )}
      onOpenAttempt={(attemptN) =>
        navigate(`/tasks/${task.id}/attempts/${attemptN}`)
      }
      onOpenRuntimeProfile={() => navigate('/runtime/profiles')}
      onOpenDiary={(diaryId) => navigate(`/diaries/${diaryId}`)}
      onOpenConsole={(selected) => {
        if (selected.consoleUrl) window.open(selected.consoleUrl, '_blank');
      }}
      onOpenTaskRef={(ref) => {
        if (ref.taskId) navigate(`/tasks/${ref.taskId}`);
      }}
      onOpenExternalRef={(ref) => {
        if (ref.external?.url) window.open(ref.external.url, '_blank');
      }}
      onRetryAttempts={() => void attemptsQuery.refetch()}
      onRetryKnowledge={() => void knowledgeQuery.refetch()}
      footer={
        <ManageTaskGrants
          taskId={task.id}
          teamId={task.teamId}
          canManage={selectedTeam?.role === 'owner'}
        />
      }
    />
  );
}
