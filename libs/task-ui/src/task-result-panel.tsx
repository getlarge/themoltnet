import {
  Badge,
  Button,
  ControlSurface,
  DescriptionList,
  Divider,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useId } from 'react';

import { Disclosure } from './disclosure.js';
import { formatDateTime } from './format.js';
import { Identifier } from './identifier.js';
import { JsonViewer } from './json-viewer.js';
import { MEASURE, SectionLabel } from './layout.js';
import {
  findAcceptedAttempt,
  readOutputSummary,
  readVerification,
} from './task-output.js';
import {
  resolveTaskOutputRenderer,
  type TaskOutputRenderer,
} from './task-output-renderers.js';
import { TaskStatusBadge } from './task-status-badge.js';
import { TaskVerificationSummary } from './task-verification-summary.js';
import type { TaskAttemptSummary, TaskSummary } from './types.js';

export interface TaskResultPanelProps {
  task: TaskSummary;
  attempts: TaskAttemptSummary[];
  /** Renderers tried ahead of the built-in ones. */
  renderers?: readonly TaskOutputRenderer[];
  onOpenAttempt?: (attemptN: number) => void;
}

type ResultState =
  | { kind: 'accepted'; attempt: TaskAttemptSummary }
  | { kind: 'running'; attempt: TaskAttemptSummary }
  | { kind: 'unsuccessful'; attempt: TaskAttemptSummary }
  | { kind: 'closed' }
  | { kind: 'pending' };

const IN_FLIGHT_ATTEMPT = new Set(['claimed', 'running']);

const ENDED: Partial<Record<TaskAttemptSummary['status'], string>> = {
  failed: 'failed',
  timed_out: 'timed out',
  aborted: 'was aborted',
  cancelled: 'was cancelled',
};

export function getTaskResultState(
  task: TaskSummary,
  attempts: TaskAttemptSummary[],
): ResultState {
  const accepted = findAcceptedAttempt(task, attempts);
  if (accepted) return { kind: 'accepted', attempt: accepted };

  const latest = attempts.at(-1);
  if (latest && IN_FLIGHT_ATTEMPT.has(latest.status)) {
    return { kind: 'running', attempt: latest };
  }
  if (task.status === 'cancelled' || task.status === 'expired') {
    return { kind: 'closed' };
  }
  if (latest && latest.status !== 'completed') {
    return { kind: 'unsuccessful', attempt: latest };
  }
  return { kind: 'pending' };
}

/**
 * The task's answer, placed above the execution record: what the accepted
 * attempt produced, the agent's self-check, and the evidence behind it.
 * Before a result exists it states plainly where the task stands instead.
 */
export function TaskResultPanel({
  task,
  attempts,
  renderers,
  onOpenAttempt,
}: TaskResultPanelProps) {
  const state = getTaskResultState(task, attempts);
  return state.kind === 'accepted' ? (
    <AcceptedResult
      task={task}
      attempt={state.attempt}
      renderers={renderers}
      onOpenAttempt={onOpenAttempt}
    />
  ) : (
    <PendingResult task={task} state={state} onOpenAttempt={onOpenAttempt} />
  );
}

function AcceptedResult({
  task,
  attempt,
  renderers,
  onOpenAttempt,
}: {
  task: TaskSummary;
  attempt: TaskAttemptSummary;
  renderers?: readonly TaskOutputRenderer[];
  onOpenAttempt?: (attemptN: number) => void;
}) {
  const theme = useTheme();
  const headingId = useId();
  const output = attempt.output;
  const context = output ? { task, attempt, output } : null;
  const Body = context
    ? resolveTaskOutputRenderer(context, renderers).Body
    : null;
  const summary = readOutputSummary(output);
  const verification = readVerification(output);
  const criteriaDeclared = Boolean(
    (task.input as { successCriteria?: unknown }).successCriteria,
  );
  const executorFingerprint =
    attempt.completedExecutorFingerprint ?? attempt.claimedExecutorFingerprint;

  return (
    <ControlSurface
      as="section"
      aria-labelledby={headingId}
      padding="none"
      style={{ padding: 'clamp(1.25rem, 3vw, 2rem)' }}
    >
      <Stack gap={6}>
        <Stack gap={4}>
          <Stack
            direction="row"
            justify="space-between"
            align="flex-start"
            gap={3}
            wrap
          >
            <Stack gap={2} style={{ minWidth: 0, flex: '1 1 20rem' }}>
              <Stack direction="row" align="center" gap={3} wrap>
                <Text as="h2" variant="h3" id={headingId}>
                  Result
                </Text>
                <Badge variant="success">
                  <span aria-hidden="true">✓&nbsp;</span>Accepted
                </Badge>
              </Stack>
              <Text variant="caption" color="secondary">
                {[
                  `Attempt #${attempt.attemptN}`,
                  `completed ${formatDateTime(attempt.completedAt ?? task.completedAt)}`,
                  attempt.contentSignature
                    ? 'signed by the claiming agent'
                    : 'unsigned',
                ].join(' · ')}
              </Text>
            </Stack>
            {onOpenAttempt ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onOpenAttempt(attempt.attemptN)}
              >
                Open full attempt
              </Button>
            ) : null}
          </Stack>

          {summary ? (
            <p
              style={{
                margin: 0,
                maxWidth: '68ch',
                color: theme.color.text.DEFAULT,
                // Lead paragraph: 17px on phones rising to 20px on wide
                // screens; long summaries stay at 18px.
                fontSize:
                  summary.length > 480
                    ? theme.font.size.lg
                    : 'clamp(1.0625rem, 0.97rem + 0.4vw, 1.25rem)',
                lineHeight: 1.45,
                textWrap: 'pretty',
                overflowWrap: 'anywhere',
              }}
            >
              {summary}
            </p>
          ) : output ? null : (
            <Text color="secondary">
              The attempt was accepted without a recorded output.
            </Text>
          )}
        </Stack>

        {context && Body ? (
          <>
            <Divider />
            <Body {...context} />
          </>
        ) : null}

        <Divider />

        <Stack gap={4}>
          <TaskVerificationSummary
            verification={verification}
            criteriaDeclared={criteriaDeclared}
          />
          <Disclosure
            summary="Evidence"
            hint="Output CID, signature, executor, raw output"
          >
            <Stack gap={4}>
              <DescriptionList
                columns={2}
                compact
                ariaLabel="Result evidence"
                items={[
                  {
                    label: 'Output CID',
                    value: attempt.outputCid ? (
                      <Identifier
                        value={attempt.outputCid}
                        copyLabel="Copy output CID"
                      />
                    ) : (
                      'Not reported'
                    ),
                  },
                  {
                    label: 'Signature',
                    value: attempt.contentSignature
                      ? `Signed by the claiming agent ${formatDateTime(attempt.signedAt)}; the server verified it at completion.`
                      : 'Not signed',
                  },
                  {
                    label: 'Claimed by agent',
                    value: <Identifier value={attempt.claimedByAgentId} />,
                  },
                  {
                    label: 'Executor fingerprint',
                    value: executorFingerprint ?? 'Not attested',
                    mono: Boolean(executorFingerprint),
                  },
                  ...(verification?.inputCid
                    ? [
                        {
                          label: 'Self-check pinned to input',
                          value: <Identifier value={verification.inputCid} />,
                        },
                      ]
                    : []),
                ]}
              />
              {output ? (
                <Stack gap={1}>
                  <SectionLabel>Raw output</SectionLabel>
                  <JsonViewer value={output} />
                </Stack>
              ) : null}
            </Stack>
          </Disclosure>
        </Stack>
      </Stack>
    </ControlSurface>
  );
}

function PendingResult({
  task,
  state,
  onOpenAttempt,
}: {
  task: TaskSummary;
  state: Exclude<ResultState, { kind: 'accepted' }>;
  onOpenAttempt?: (attemptN: number) => void;
}) {
  const theme = useTheme();
  const headingId = useId();
  const copy = pendingCopy(task, state);
  const attempt = 'attempt' in state ? state.attempt : null;

  return (
    <ControlSurface as="section" aria-labelledby={headingId} padding="md">
      <Stack gap={3}>
        <Stack direction="row" align="center" gap={3} wrap>
          <Text as="h2" variant="h3" id={headingId}>
            Result
          </Text>
          <TaskStatusBadge status={attempt?.status ?? task.status} />
        </Stack>
        <Text style={{ maxWidth: '68ch' }}>{copy.title}</Text>
        {copy.detail ? (
          <Text
            variant="caption"
            color="secondary"
            style={{ maxWidth: MEASURE }}
          >
            {copy.detail}
          </Text>
        ) : null}
        {state.kind === 'unsuccessful' && state.attempt.error ? (
          <div
            style={{
              padding: theme.spacing[3],
              borderRadius: theme.radius.md,
              background: theme.color.error.muted,
              border: `1px solid ${theme.color.border.DEFAULT}`,
            }}
          >
            <Stack gap={1}>
              <Text variant="caption" mono weight="semibold">
                {state.attempt.error.code}
              </Text>
              <Text variant="caption" style={{ overflowWrap: 'anywhere' }}>
                {state.attempt.error.message}
              </Text>
            </Stack>
          </div>
        ) : null}
        {attempt && onOpenAttempt ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenAttempt(attempt.attemptN)}
            style={{ alignSelf: 'flex-start' }}
          >
            {state.kind === 'running'
              ? `Watch attempt #${attempt.attemptN}`
              : `Open attempt #${attempt.attemptN}`}
          </Button>
        ) : null}
      </Stack>
    </ControlSurface>
  );
}

function pendingCopy(
  task: TaskSummary,
  state: Exclude<ResultState, { kind: 'accepted' }>,
): { title: string; detail?: string } {
  switch (state.kind) {
    case 'running': {
      const { attempt } = state;
      return {
        title: attempt.startedAt
          ? `Attempt #${attempt.attemptN} has been running since ${formatDateTime(attempt.startedAt)}.`
          : `Attempt #${attempt.attemptN} was claimed ${formatDateTime(attempt.claimedAt)} and has not started yet.`,
        detail:
          'The result appears here when the attempt completes and the Task Engine accepts it.',
      };
    }
    case 'unsuccessful': {
      const { attempt } = state;
      const retrying = ['queued', 'dispatched', 'running', 'waiting'].includes(
        task.status,
      );
      return {
        title: `Attempt #${attempt.attemptN} ${ENDED[attempt.status] ?? 'ended'} without an accepted result.`,
        detail: retrying
          ? `The task is ${task.status} for another attempt (${attempt.attemptN} of ${task.maxAttempts} used).`
          : task.status === 'failed'
            ? `No attempts remain: ${attempt.attemptN} of ${task.maxAttempts} used. The task failed.`
            : undefined,
      };
    }
    case 'closed':
      return {
        title:
          task.status === 'expired'
            ? `The task expired ${formatDateTime(task.expiresAt)} before any attempt was accepted.`
            : 'The task was cancelled before any attempt was accepted.',
        detail: task.cancelReason ? `Reason: ${task.cancelReason}` : undefined,
      };
    case 'pending':
      return {
        title:
          task.status === 'waiting'
            ? 'No result yet. The task is waiting for its claim condition to be met.'
            : task.status === 'dispatched'
              ? 'No result yet. An agent claimed the task and has not started running it.'
              : `No result yet. Queued ${formatDateTime(task.queuedAt)}; no agent has claimed it.`,
        detail:
          'An agent claims the task, runs it under a runtime profile, and reports a signed output. The accepted output appears here.',
      };
  }
}
