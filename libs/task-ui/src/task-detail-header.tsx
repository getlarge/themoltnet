import {
  Button,
  Card,
  CopyButton,
  DescriptionList,
  type DescriptionListItem,
  Stack,
  Text,
} from '@themoltnet/design-system';
import { type ReactNode, useId, useState } from 'react';

import { formatDateTime, humanizeToken } from './format.js';
import { TaskStatusBadge } from './task-status-badge.js';
import type { TaskLabelRenderer, TaskSummary } from './types.js';

export interface TaskDetailHeaderProps {
  task: TaskSummary;
  renderTeamLabel?: TaskLabelRenderer;
  renderDiaryLabel?: TaskLabelRenderer;
  renderActorLabel?: TaskLabelRenderer;
  onOpenConsole?: (task: TaskSummary) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_FIELDS = ['brief', 'taskPrompt', 'prompt', 'instructions'];
/** Briefs longer than this start clamped to three lines. */
const REQUEST_CLAMP_CHARS = 320;
const REQUEST_CLAMP_LINES = 4;

/**
 * The natural-language request in a task input, when its type has one
 * (`freeform.brief`, `taskPrompt`, …). Null for purely structured inputs.
 */
function readTaskRequest(input: Record<string, unknown>): string | null {
  for (const field of REQUEST_FIELDS) {
    const value = input[field];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

export function TaskDetailHeader({
  task,
  renderTeamLabel,
  renderDiaryLabel,
  renderActorLabel,
  onOpenConsole,
}: TaskDetailHeaderProps) {
  const actorId = task.proposedByAgentId ?? task.proposedByHumanId;
  const taskTitle = task.title || humanizeToken(task.taskType);
  const request = readTaskRequest(task.input);
  const requestId = useId();
  const [requestOpen, setRequestOpen] = useState(false);
  const requestIsLong = Boolean(
    request &&
    (request.length > REQUEST_CLAMP_CHARS ||
      request.split('\n').length > REQUEST_CLAMP_LINES),
  );
  const requestClamped = requestIsLong && !requestOpen;

  // Mono only for raw identifiers, never for labels a host substituted.
  const fact = (label: string, value: ReactNode): DescriptionListItem => ({
    label,
    value,
    mono: typeof value === 'string' && UUID.test(value),
  });

  const facts: DescriptionListItem[] = [
    fact('Task type', humanizeToken(task.taskType)),
    fact('Proposer', renderActorLabel?.(actorId) ?? actorId ?? '—'),
    fact('Team', renderTeamLabel?.(task.teamId) ?? task.teamId),
    fact('Diary', renderDiaryLabel?.(task.diaryId) ?? task.diaryId ?? '—'),
    fact('Queued', formatDateTime(task.queuedAt)),
    ...(task.completedAt
      ? [fact('Completed', formatDateTime(task.completedAt))]
      : task.expiresAt
        ? [fact('Expires', formatDateTime(task.expiresAt))]
        : []),
    ...(task.tags.length > 0 ? [fact('Tags', task.tags.join(', '))] : []),
    ...(task.correlationId
      ? [
          {
            label: 'Correlation ID',
            value: (
              <CopyButton
                value={task.correlationId}
                size="sm"
                ariaLabel="Copy correlation ID"
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <Card variant="outlined" padding="md">
      <Stack gap={5}>
        <Stack
          direction="row"
          justify="space-between"
          align="flex-start"
          gap={4}
          wrap
        >
          <Stack gap={3} style={{ minWidth: 0, flex: '1 1 28rem' }}>
            <Stack direction="row" align="center" gap={3} wrap>
              <TaskStatusBadge status={task.status} />
              <Text variant="h2" style={{ margin: 0 }}>
                {taskTitle}
              </Text>
            </Stack>
            {request ? (
              <Stack gap={1}>
                <Text variant="caption" color="muted">
                  Asked
                </Text>
                <Text
                  id={requestId}
                  color="secondary"
                  style={{
                    maxWidth: '72ch',
                    overflowWrap: 'anywhere',
                    whiteSpace: 'pre-line',
                    ...(requestClamped
                      ? {
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }
                      : null),
                  }}
                >
                  {request}
                </Text>
                {requestIsLong ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={requestOpen}
                    aria-controls={requestId}
                    onClick={() => setRequestOpen((open) => !open)}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {requestOpen ? 'Show less' : 'Show the full brief'}
                  </Button>
                ) : null}
              </Stack>
            ) : null}
          </Stack>

          <Stack gap={2} align="flex-start" style={{ minWidth: 0 }}>
            <CopyButton value={task.id} size="sm" ariaLabel="Copy task ID" />
            {task.consoleUrl && onOpenConsole ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onOpenConsole(task)}
              >
                Open full console
              </Button>
            ) : null}
          </Stack>
        </Stack>

        <DescriptionList items={facts} columns={4} compact />
      </Stack>
    </Card>
  );
}
