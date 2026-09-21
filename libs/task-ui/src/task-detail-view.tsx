import {
  Button,
  Card,
  InlineNotice,
  PageHeader,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import type { ReactNode } from 'react';

import { TaskActionPanel } from './task-action-panel.js';
import { TaskAttemptsTable } from './task-attempts-table.js';
import { TaskDetailHeader } from './task-detail-header.js';
import { TaskExecutionRecord } from './task-execution-record.js';
import { TaskInputViewer } from './task-input-viewer.js';
import {
  type TaskKnowledgeEntry,
  TaskKnowledgeList,
} from './task-knowledge-list.js';
import { readFreeformOutput } from './task-output.js';
import type { TaskOutputRenderer } from './task-output-renderers.js';
import { TaskRefsList } from './task-refs-list.js';
import { TaskResultPanel } from './task-result-panel.js';
import type {
  TaskAttemptSummary,
  TaskLabelRenderer,
  TaskRef,
  TaskSummary,
} from './types.js';

export type TaskDetailLoadState = 'ready' | 'loading' | 'error';

export interface TaskDetailKnowledge {
  entries: TaskKnowledgeEntry[];
  total: number | null;
  status: TaskDetailLoadState;
}

export interface TaskDetailViewProps {
  task: TaskSummary;
  attempts: TaskAttemptSummary[];
  attemptsStatus?: TaskDetailLoadState;
  knowledge: TaskDetailKnowledge;
  /** Output renderers tried before the generic fallback. */
  renderers?: readonly TaskOutputRenderer[];
  /**
   * Presentation surfaces (demos, captures): shortens identifiers and hides
   * operator-only panels. Every product component stays the same.
   */
  presentation?: boolean;
  /** Shown above the task header, e.g. an "illustrative data" notice. */
  notice?: ReactNode;
  backLink?: ReactNode;
  /** Rendered after the view, e.g. host-owned grant management. */
  footer?: ReactNode;
  renderTeamLabel?: TaskLabelRenderer;
  renderDiaryLabel?: TaskLabelRenderer;
  renderActorLabel?: TaskLabelRenderer;
  renderEntryLink?: (
    entry: TaskKnowledgeEntry,
    children: ReactNode,
  ) => ReactNode;
  onOpenAttempt?: (attemptN: number) => void;
  onOpenRuntimeProfile?: (attempt: TaskAttemptSummary) => void;
  onOpenDiary?: (diaryId: string) => void;
  onOpenConsole?: (task: TaskSummary) => void;
  onOpenTaskRef?: (ref: TaskRef) => void;
  onOpenExternalRef?: (ref: TaskRef) => void;
  onRetryAttempts?: () => void;
  onRetryKnowledge?: () => void;
}

/**
 * The task detail page body, independent of data fetching and routing.
 *
 * Order answers the operator's questions in turn: what was asked (header),
 * what came back (result), what was kept (knowledge), and how it happened
 * (execution record), with the durable contract and attempts underneath.
 */
export function TaskDetailView({
  task,
  attempts,
  attemptsStatus = 'ready',
  knowledge,
  renderers,
  presentation = false,
  notice,
  backLink,
  footer,
  renderTeamLabel,
  renderDiaryLabel,
  renderActorLabel,
  renderEntryLink,
  onOpenAttempt,
  onOpenRuntimeProfile,
  onOpenDiary,
  onOpenConsole,
  onOpenTaskRef,
  onOpenExternalRef,
  onRetryAttempts,
  onRetryKnowledge,
}: TaskDetailViewProps) {
  const latestAttempt = attempts.at(-1) ?? null;
  const recordAttempt = task.acceptedAttemptN
    ? (attempts.find((attempt) => attempt.attemptN === task.acceptedAttemptN) ??
      latestAttempt)
    : latestAttempt;
  const acceptedOutput =
    task.acceptedAttemptN === recordAttempt?.attemptN
      ? recordAttempt.output
      : null;
  const citedEntryIds = readFreeformOutput(acceptedOutput)?.diaryEntryIds ?? [];
  const diaryId = task.diaryId;

  return (
    <Stack gap={6}>
      <PageHeader
        eyebrow="Task Engine"
        title="Task execution"
        description="What this task asked for, what it produced, and the authority and evidence behind it."
        backLink={backLink}
      />

      {notice}

      <TaskDetailHeader
        task={task}
        renderTeamLabel={renderTeamLabel}
        renderDiaryLabel={renderDiaryLabel}
        renderActorLabel={renderActorLabel}
        onOpenConsole={presentation ? undefined : onOpenConsole}
        compactIdentifiers={presentation}
      />

      {attemptsStatus === 'loading' ? (
        <Card variant="surface" padding="md">
          <Text color="muted">Loading attempt evidence…</Text>
        </Card>
      ) : attemptsStatus === 'error' ? (
        <InlineNotice tone="warning" title="Attempt evidence unavailable">
          <Stack gap={3}>
            <Text>
              The result, claim, and runtime state cannot be shown until the
              attempt history is available.
            </Text>
            {onRetryAttempts ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={onRetryAttempts}
                style={{ alignSelf: 'flex-start' }}
              >
                Retry attempt evidence
              </Button>
            ) : null}
          </Stack>
        </InlineNotice>
      ) : (
        <>
          <SplitRow
            main={
              <TaskResultPanel
                task={task}
                attempts={attempts}
                renderers={renderers}
                compactIdentifiers={presentation}
                onOpenAttempt={onOpenAttempt}
              />
            }
            rail={
              <TaskKnowledgeList
                entries={knowledge.entries}
                total={knowledge.total}
                status={knowledge.status}
                diaryConfigured={Boolean(diaryId)}
                citedEntryIds={citedEntryIds}
                acceptedAttemptN={task.acceptedAttemptN}
                renderEntryLink={renderEntryLink}
                onOpenDiary={
                  diaryId && onOpenDiary
                    ? () => onOpenDiary(diaryId)
                    : undefined
                }
                onRetry={onRetryKnowledge}
              />
            }
          />

          <TaskExecutionRecord
            task={task}
            attempt={recordAttempt}
            compactIdentifiers={presentation}
            knowledge={{
              count: diaryId
                ? knowledge.status === 'ready'
                  ? knowledge.total
                  : null
                : 0,
              unavailable: knowledge.status === 'error',
            }}
            attemptAction={
              recordAttempt && onOpenAttempt ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenAttempt(recordAttempt.attemptN)}
                >
                  Inspect attempt
                </Button>
              ) : undefined
            }
            runtimeAction={
              recordAttempt?.runtimeProfileId && onOpenRuntimeProfile ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenRuntimeProfile(recordAttempt)}
                >
                  Open profile
                </Button>
              ) : undefined
            }
            knowledgeAction={
              diaryId && onOpenDiary ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenDiary(diaryId)}
                >
                  Open diary
                </Button>
              ) : undefined
            }
          />
        </>
      )}

      <SplitRow
        main={
          <Stack gap={5}>
            <Card variant="surface" padding="md">
              <TaskInputViewer
                input={task.input}
                inputCid={task.inputCid}
                compactCid={presentation}
              />
            </Card>

            <Card variant="surface" padding="md">
              <Stack gap={3}>
                <Text variant="h3" style={{ margin: 0 }}>
                  References
                </Text>
                <TaskRefsList
                  refs={task.references}
                  onOpenTaskRef={onOpenTaskRef}
                  onOpenExternalRef={onOpenExternalRef}
                />
              </Stack>
            </Card>

            <Card variant="surface" padding="md">
              <Stack gap={3}>
                <Text variant="h3" style={{ margin: 0 }}>
                  Attempts
                </Text>
                {attemptsStatus === 'error' ? (
                  <Text color="muted">Attempt history unavailable.</Text>
                ) : (
                  <TaskAttemptsTable
                    attempts={attempts}
                    onSelectAttempt={
                      onOpenAttempt
                        ? (attempt) => onOpenAttempt(attempt.attemptN)
                        : undefined
                    }
                  />
                )}
              </Stack>
            </Card>
          </Stack>
        }
        rail={
          presentation ? null : (
            <TaskActionPanel task={task} selectedAttempt={latestAttempt} />
          )
        }
      />

      {footer}
    </Stack>
  );
}

// Flex-wrap sidebar: the rail sits beside the main column when both fit their
// minimum widths and drops below it otherwise, without a viewport hook. The
// main column's large grow factor keeps the rail narrow.
function SplitRow({ main, rail }: { main: ReactNode; rail: ReactNode }) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: theme.spacing[5],
        alignItems: 'flex-start',
      }}
    >
      <div style={{ flex: '999 1 34rem', minWidth: 0 }}>{main}</div>
      {rail ? (
        <div style={{ flex: '1 1 18rem', minWidth: 0 }}>{rail}</div>
      ) : null}
    </div>
  );
}
