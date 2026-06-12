import { createTask } from '@moltnet/api-client';
import {
  getTaskOptions,
  listTaskAttemptsOptions,
  listTaskMessagesOptions,
  listTaskSchemasOptions,
} from '@moltnet/api-client/query';
import {
  canContinueAttempt,
  CreateTaskDialog,
  type CreateTaskRequest,
  formatRelativeAge,
  TaskActionPanel,
  TaskAttemptDetail,
  TaskMessagesTimeline,
} from '@moltnet/task-ui';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  Stack,
  Text,
  Tooltip,
  useTheme,
} from '@themoltnet/design-system';
import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';

import { getApiClient } from '../api.js';
import { useDiarySummaries } from '../diaries/hooks.js';
import { useIsMobile } from '../hooks/useIsMobile.js';

export function TaskAttemptPage({
  id,
  attemptN,
}: {
  id: string;
  attemptN: number;
}) {
  const theme = useTheme();
  const isMobile = useIsMobile();
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

  const [, navigate] = useLocation();
  const [showContinue, setShowContinue] = useState(false);
  const diariesQuery = useDiarySummaries(task?.teamId ?? null);
  const diaryOptions = useMemo(
    () => (diariesQuery.data ?? []).map((d) => ({ id: d.id, name: d.name })),
    [diariesQuery.data],
  );
  const schemasQuery = useQuery({
    ...listTaskSchemasOptions({ client: getApiClient() }),
    enabled: Boolean(task),
  });
  const registeredTaskTypes = useMemo(
    () => (schemasQuery.data?.items ?? []).map((s) => s.taskType),
    [schemasQuery.data],
  );

  const eligibility =
    task && attempt
      ? canContinueAttempt(task, attempt)
      : { eligible: false, resumableUntil: null, expired: false };

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

  const sourceTitle = task.title ?? '';

  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <Link
          href={`/tasks/${id}`}
          style={{ color: theme.color.text.muted, textDecoration: 'none' }}
        >
          &larr; Task detail
        </Link>
        <Stack direction="row" gap={3} align="center" wrap>
          <Text variant="h2" style={{ margin: 0 }}>
            Attempt {attemptN}
          </Text>
          {/*
            Badge appears only on completed freeform attempts that ever
            reported a slotResumableUntil. Running/claimed attempts whose
            daemons happen to publish a heartbeat-time slot would render
            a misleading "Resumable until …" otherwise. The expired path
            still surfaces the timestamp (muted) so the user understands
            why Continue isn't offered.
          */}
          {(eligibility.eligible || eligibility.expired) &&
          eligibility.resumableUntil ? (
            <Tooltip
              content={
                eligibility.expired
                  ? 'The warm slot TTL has elapsed; the daemon no longer guarantees a resumable session for this attempt.'
                  : 'Daemon-local hint: the executor reported the warm slot would survive at least this long. Restart or eviction can shorten it.'
              }
            >
              <Badge variant={eligibility.expired ? 'default' : 'info'}>
                {eligibility.expired ? 'Slot expired' : 'Resumable until'}{' '}
                {formatRelativeAge(eligibility.resumableUntil.toISOString())}
              </Badge>
            </Tooltip>
          ) : null}
          {eligibility.eligible ? (
            <Button size="sm" onClick={() => setShowContinue(true)}>
              Continue
            </Button>
          ) : null}
        </Stack>
      </Stack>

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

      {eligibility.eligible ? (
        <CreateTaskDialog
          open={showContinue}
          teamId={task.teamId}
          diaries={diaryOptions}
          candidateTasks={[]}
          availableTypes={registeredTaskTypes}
          continueFrom={{
            taskId: task.id,
            attemptN,
            sourceTitle: sourceTitle || undefined,
            correlationId: task.correlationId,
            // Inherit profile pinning from the source — mirrors what
            // the MCP tasks_continue tool and the Go CLI task continue
            // do. Dropping these would let the continuation be claimed
            // by a profile the parent's proposer excluded, or relax
            // the trust-level pin.
            allowedProfiles: task.allowedProfiles,
            requiredExecutorTrustLevel: task.requiredExecutorTrustLevel,
          }}
          onClose={() => setShowContinue(false)}
          onSubmit={async (request: CreateTaskRequest) => {
            const { data, error: apiError } = await createTask({
              client: getApiClient(),
              body: request,
            });
            if (apiError || !data || !('id' in data)) {
              const detail =
                apiError && typeof apiError === 'object' && 'detail' in apiError
                  ? String((apiError as { detail?: unknown }).detail)
                  : 'Failed to create continuation';
              throw new Error(detail);
            }
            return data.id;
          }}
          onCreated={(taskId) => {
            setShowContinue(false);
            navigate(`/tasks/${taskId}`);
          }}
        />
      ) : null}
    </Stack>
  );
}
