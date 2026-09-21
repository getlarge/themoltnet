import {
  Badge,
  Button,
  ControlSurface,
  Stack,
  Text,
} from '@themoltnet/design-system';
import { type ReactNode, useId } from 'react';

import { formatDateTime, humanizeToken } from './format.js';
import { lineClamp, MEASURE, RuledList } from './layout.js';

/** The fields of a diary entry the task view needs. */
export interface TaskKnowledgeEntry {
  id: string;
  title: string | null;
  entryType: string;
  createdAt: string;
  content?: string;
  signed?: boolean;
  tags?: readonly string[] | null;
}

const ATTEMPT_TAG = /^(?:task:attempt:|task_attempt:)(\d+)$/;

/**
 * The attempt that wrote an entry, from its `task:attempt:<n>` provenance
 * tag (or the legacy `task_attempt:<n>` form). Null when untagged.
 */
export function readEntryAttempt(entry: TaskKnowledgeEntry): number | null {
  for (const tag of entry.tags ?? []) {
    const match = ATTEMPT_TAG.exec(tag);
    if (match) return Number(match[1]);
  }
  return null;
}

export interface TaskKnowledgeListProps {
  entries: TaskKnowledgeEntry[];
  /** Total entries tagged to the task; may exceed `entries.length`. */
  total: number | null;
  status: 'ready' | 'loading' | 'error';
  diaryConfigured: boolean;
  /** Entry ids the accepted output lists in `diaryEntryIds`. */
  citedEntryIds?: readonly string[];
  /** Orders the accepted attempt's entries first and labels them. */
  acceptedAttemptN?: number | null;
  /** Wraps an entry title in the host's link. Titles render as text otherwise. */
  renderEntryLink?: (
    entry: TaskKnowledgeEntry,
    children: ReactNode,
  ) => ReactNode;
  onOpenDiary?: () => void;
  onRetry?: () => void;
}

/**
 * Diary entries tagged `task:id:<id>`: what the agent kept for later work.
 *
 * Kept apart from the result on purpose. An entry title is the agent's note
 * to its future self, not a finding of this task, unless the accepted output
 * cites the entry in `diaryEntryIds`. Each entry names the attempt that wrote
 * it, from the `task:attempt:<n>` provenance tag, so knowledge kept by a
 * failed attempt is never mistaken for the accepted run's.
 */
export function TaskKnowledgeList({
  entries,
  total,
  status,
  diaryConfigured,
  citedEntryIds = [],
  acceptedAttemptN = null,
  renderEntryLink,
  onOpenDiary,
  onRetry,
}: TaskKnowledgeListProps) {
  const headingId = useId();
  const cited = new Set(citedEntryIds);
  const shown = entries.length;
  // Stable sort: the accepted attempt's entries first, then the rest as given.
  const ordered =
    acceptedAttemptN === null
      ? entries
      : [...entries].sort(
          (a, b) =>
            Number(readEntryAttempt(b) === acceptedAttemptN) -
            Number(readEntryAttempt(a) === acceptedAttemptN),
        );

  let body: ReactNode;
  if (!diaryConfigured) {
    body = (
      <Text color="secondary">
        This task has no diary, so it could not retain knowledge.
      </Text>
    );
  } else if (status === 'loading') {
    body = <Text color="muted">Loading retained knowledge…</Text>;
  } else if (status === 'error') {
    body = (
      <Stack gap={2}>
        <Text color="secondary">
          Retained knowledge could not be loaded. The result above is
          unaffected.
        </Text>
        {onRetry ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onRetry}
            style={{ alignSelf: 'flex-start' }}
          >
            Retry
          </Button>
        ) : null}
      </Stack>
    );
  } else if (shown === 0) {
    body = (
      <Text color="secondary">
        No diary entries are tagged to this task. An agent retains knowledge by
        writing entries tagged with the task’s ID.
      </Text>
    );
  } else {
    body = (
      <RuledList labelledBy={headingId}>
        {ordered.map((entry) => {
          const title = entry.title?.trim() || 'Untitled entry';
          const attemptN = readEntryAttempt(entry);
          const fromAccepted =
            attemptN !== null && attemptN === acceptedAttemptN;
          const excerpt = entry.content ? toExcerpt(entry.content) : null;
          return (
            <Stack key={entry.id} gap={1}>
              <Text as="h3" variant="body" weight="medium">
                {renderEntryLink ? renderEntryLink(entry, title) : title}
              </Text>
              <Stack direction="row" gap={2} align="center" wrap>
                <Text variant="caption" color="muted">
                  {humanizeToken(entry.entryType)} ·{' '}
                  {formatDateTime(entry.createdAt)}
                  {entry.signed ? ' · signed' : ''}
                </Text>
                {attemptN !== null ? (
                  <Badge variant={fromAccepted ? 'success' : 'default'}>
                    {fromAccepted
                      ? `Accepted attempt #${attemptN}`
                      : `Attempt #${attemptN}`}
                  </Badge>
                ) : null}
                {cited.has(entry.id) ? (
                  <Badge variant="primary">Cited in the result</Badge>
                ) : null}
              </Stack>
              {excerpt ? (
                <Text
                  variant="caption"
                  color="secondary"
                  style={{ maxWidth: MEASURE, ...lineClamp(2) }}
                >
                  {excerpt}
                </Text>
              ) : null}
            </Stack>
          );
        })}
      </RuledList>
    );
  }

  return (
    <ControlSurface as="section" aria-labelledby={headingId} padding="md">
      <Stack gap={4}>
        <Stack gap={1} style={{ minWidth: 0 }}>
          <Stack direction="row" align="center" gap={2} wrap>
            <Text as="h2" variant="h4" id={headingId}>
              Knowledge retained
            </Text>
            {status === 'ready' && total !== null && total > 0 ? (
              <Badge>{total}</Badge>
            ) : null}
          </Stack>
          <Text
            variant="caption"
            color="secondary"
            style={{ maxWidth: MEASURE }}
          >
            Diary entries tagged to this task, kept for later work. They are not
            part of the result.
          </Text>
        </Stack>
        {body}
        {status === 'ready' && total !== null && total > shown ? (
          <Text variant="caption" color="muted">
            Showing {shown} of {total}. The rest are in the diary.
          </Text>
        ) : null}
        {diaryConfigured && onOpenDiary ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenDiary}
            style={{ alignSelf: 'flex-start' }}
          >
            Open diary
          </Button>
        ) : null}
      </Stack>
    </ControlSurface>
  );
}

function toExcerpt(content: string) {
  // Entries can hold up to 100k characters; only the opening matters here.
  const text = content
    .slice(0, 1200)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 280 ? `${text.slice(0, 277)}…` : text;
}
