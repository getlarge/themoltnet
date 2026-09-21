import {
  Button,
  Card,
  CopyButton,
  DescriptionList,
  type DescriptionListItem,
  Stack,
  Text,
} from '@themoltnet/design-system';
import type { ReactNode } from 'react';

import { formatDateTime, humanizeToken } from './format.js';
import {
  compactIdentifier,
  Identifier,
  useCompactIdentifiers,
} from './identifier.js';
import { lineClamp, MEASURE, useExpandable } from './layout.js';
import { TaskStatusBadge } from './task-status-badge.js';
import type { TaskLabelRenderer, TaskSummary } from './types.js';

export interface TaskDetailHeaderProps {
  task: TaskSummary;
  renderTeamLabel?: TaskLabelRenderer;
  renderDiaryLabel?: TaskLabelRenderer;
  renderActorLabel?: TaskLabelRenderer;
  onOpenConsole?: (task: TaskSummary) => void;
}

const REQUEST_FIELDS = ['brief', 'taskPrompt', 'prompt', 'instructions'];
/** Briefs longer than this, in characters or lines, start clamped. */
const REQUEST_CLAMP_CHARS = 320;
const REQUEST_CLAMP_LINES = 3;

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
  const compact = useCompactIdentifiers();
  const expandable = useExpandable();
  const requestIsLong = Boolean(
    request &&
    (request.length > REQUEST_CLAMP_CHARS ||
      request.split('\n').length > REQUEST_CLAMP_LINES),
  );
  const requestClamped = requestIsLong && !expandable.expanded;

  const fact = (label: string, value: ReactNode): DescriptionListItem => ({
    label,
    value,
  });
  // A host label when one is rendered, otherwise the raw identifier.
  const idFact = (
    label: string,
    raw: string | null,
    render?: TaskLabelRenderer,
  ): DescriptionListItem =>
    fact(label, render?.(raw) ?? (raw ? <Identifier value={raw} /> : '—'));

  const facts: DescriptionListItem[] = [
    fact('Task type', humanizeToken(task.taskType)),
    idFact('Proposer', actorId, renderActorLabel),
    idFact('Team', task.teamId, renderTeamLabel),
    idFact('Diary', task.diaryId, renderDiaryLabel),
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
              <Identifier
                value={task.correlationId}
                copyLabel="Copy correlation ID"
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
          <Stack gap={3} shrink style={{ flex: '1 1 28rem' }}>
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
                  id={expandable.regionId}
                  color="secondary"
                  style={{
                    maxWidth: MEASURE,
                    overflowWrap: 'anywhere',
                    whiteSpace: 'pre-line',
                    ...(requestClamped ? lineClamp(REQUEST_CLAMP_LINES) : null),
                  }}
                >
                  {request}
                </Text>
                {requestIsLong ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    {...expandable.toggleProps}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {expandable.expanded ? 'Show less' : 'Show the full brief'}
                  </Button>
                ) : null}
              </Stack>
            ) : null}
          </Stack>

          <Stack gap={2} align="flex-start" shrink>
            <CopyButton
              value={task.id}
              text={compact ? compactIdentifier(task.id) : undefined}
              size="sm"
              ariaLabel="Copy task ID"
            />
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
