import { Card, Stack, Text, useTheme } from '@themoltnet/design-system';

import { formatDateTime } from './format.js';
import { JsonViewer } from './json-viewer.js';
import { TaskStatusBadge } from './task-status-badge.js';
import type { TaskAttemptSummary } from './types.js';

export interface TaskAttemptDetailProps {
  attempt: TaskAttemptSummary;
}

export function TaskAttemptDetail({ attempt }: TaskAttemptDetailProps) {
  const theme = useTheme();
  const usage = attempt.usage;

  return (
    <Stack gap={4}>
      <Card variant="outlined" padding="md">
        <Stack gap={3}>
          <Stack
            direction="row"
            align="center"
            justify="space-between"
            gap={3}
            wrap
          >
            <Text variant="h3" style={{ margin: 0 }}>
              Attempt {attempt.attemptN}
            </Text>
            <TaskStatusBadge status={attempt.status} />
          </Stack>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: theme.spacing[3],
            }}
          >
            {[
              ['Agent', attempt.claimedByAgentId],
              ['Runtime', attempt.runtimeId ?? '—'],
              ['Claimed', formatDateTime(attempt.claimedAt)],
              ['Started', formatDateTime(attempt.startedAt)],
              ['Completed', formatDateTime(attempt.completedAt)],
              ['Signed', formatDateTime(attempt.signedAt)],
            ].map(([label, value]) => (
              <Stack key={label} gap={1}>
                <Text variant="caption" color="muted">
                  {label}
                </Text>
                <Text style={{ overflowWrap: 'anywhere' }}>{value}</Text>
              </Stack>
            ))}
          </div>
        </Stack>
      </Card>

      {attempt.error ? (
        <Card
          variant="outlined"
          padding="md"
          style={{ borderColor: theme.color.error.DEFAULT }}
        >
          <Stack gap={2}>
            <Text variant="h4" style={{ margin: 0 }}>
              {attempt.error.code}
            </Text>
            <Text>{attempt.error.message}</Text>
            <Text variant="caption" color="muted">
              Retryable: {attempt.error.retryable ? 'yes' : 'no'}
            </Text>
          </Stack>
        </Card>
      ) : null}

      {usage ? (
        <Card variant="outlined" padding="md">
          <Stack gap={2}>
            <Text variant="h4" style={{ margin: 0 }}>
              Usage
            </Text>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                gap: theme.spacing[3],
              }}
            >
              {[
                ['Input', usage.inputTokens],
                ['Output', usage.outputTokens],
                ['Cache read', usage.cacheReadTokens ?? 0],
                ['Cache write', usage.cacheWriteTokens ?? 0],
                ['Tool calls', usage.toolCalls ?? 0],
              ].map(([label, value]) => (
                <Stack key={label} gap={1}>
                  <Text variant="caption" color="muted">
                    {label}
                  </Text>
                  <Text>{value}</Text>
                </Stack>
              ))}
            </div>
            {usage.model || usage.provider ? (
              <Text variant="caption" color="muted">
                {[usage.provider, usage.model].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </Stack>
        </Card>
      ) : null}

      {attempt.output ? (
        <JsonViewer
          label="Output"
          value={attempt.output}
          cid={attempt.outputCid}
          defaultExpanded
        />
      ) : null}
    </Stack>
  );
}
