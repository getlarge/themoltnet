import {
  getTaskOptions,
  listTaskAttemptsOptions,
  listTaskMessagesOptions,
} from '@moltnet/api-client/query';
import {
  TaskActionPanel,
  TaskAttemptDetail,
  TaskMessagesTimeline,
} from '@moltnet/task-ui';
import { useQuery } from '@tanstack/react-query';
import { Card, Stack, Text, useTheme } from '@themoltnet/design-system';
import { Link } from 'wouter';

import { getApiClient } from '../api.js';

export function TaskAttemptPage({
  id,
  attemptN,
}: {
  id: string;
  attemptN: number;
}) {
  const theme = useTheme();
  const taskQuery = useQuery({
    ...getTaskOptions({
      client: getApiClient(),
      path: { id },
    }),
  });
  const attemptsQuery = useQuery({
    ...listTaskAttemptsOptions({
      client: getApiClient(),
      path: { id },
    }),
  });
  const messagesQuery = useQuery({
    ...listTaskMessagesOptions({
      client: getApiClient(),
      path: { id, n: attemptN },
      query: { limit: 200 },
    }),
    refetchInterval: (query) => {
      const attempt = attemptsQuery.data?.find(
        (item) => item.attemptN === attemptN,
      );
      if (!attempt || !['claimed', 'running'].includes(attempt.status)) {
        return false;
      }
      return query.state.data ? 3_000 : 1_000;
    },
  });

  const task = taskQuery.data;
  const attempt = attemptsQuery.data?.find(
    (item) => item.attemptN === attemptN,
  );

  if (taskQuery.isLoading || attemptsQuery.isLoading) {
    return <Text color="muted">Loading attempt…</Text>;
  }

  if (!task || !attempt) {
    return (
      <Card style={{ padding: '1.5rem' }}>
        <Text color="muted">Attempt not found.</Text>
      </Card>
    );
  }

  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <Link
          href={`/tasks/${id}`}
          style={{ color: theme.color.text.muted, textDecoration: 'none' }}
        >
          &larr; Task detail
        </Link>
        <Text variant="h2">Attempt {attemptN}</Text>
      </Stack>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 360px)',
          gap: theme.spacing[5],
          alignItems: 'start',
        }}
      >
        <Stack gap={5}>
          <TaskAttemptDetail attempt={attempt} />
          <Card variant="surface" padding="md">
            <Stack gap={3}>
              <Text variant="h3" style={{ margin: 0 }}>
                Messages
              </Text>
              {messagesQuery.error ? (
                <Text color="muted">Failed to load messages.</Text>
              ) : (
                <TaskMessagesTimeline messages={messagesQuery.data ?? []} />
              )}
            </Stack>
          </Card>
        </Stack>

        <TaskActionPanel task={task} selectedAttempt={attempt} />
      </div>
    </Stack>
  );
}
