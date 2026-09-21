import {
  Badge,
  Button,
  ControlSurface,
  CopyButton,
  DescriptionList,
  Divider,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { type ReactNode, useId } from 'react';

import { Disclosure } from './disclosure.js';
import { formatDateTime, humanizeToken } from './format.js';
import { JsonViewer } from './json-viewer.js';
import { compactIdentifier, readVerification } from './task-output.js';
import {
  resolveTaskOutputRenderer,
  type TaskOutputRenderContext,
  type TaskOutputRenderer,
} from './task-output-renderers.js';
import { TaskVerificationSummary } from './task-verification-summary.js';
import type { TaskAttemptSummary, TaskSummary } from './types.js';

export interface TaskResultPanelProps {
  task: TaskSummary;
  attempts: TaskAttemptSummary[];
  /** Output renderers tried in order before the generic fallback. */
  renderers?: readonly TaskOutputRenderer[];
  /** Shorten UUIDs, CIDs, and hashes (presentation surfaces). */
  compactIdentifiers?: boolean;
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
  const accepted =
    task.acceptedAttemptN !== null
      ? attempts.find((attempt) => attempt.attemptN === task.acceptedAttemptN)
      : undefined;
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
  compactIdentifiers = false,
  onOpenAttempt,
}: TaskResultPanelProps) {
  const headingId = useId();
  const state = getTaskResultState(task, attempts);

  if (state.kind === 'accepted') {
    return (
      <AcceptedResult
        headingId={headingId}
        task={task}
        attempt={state.attempt}
        renderers={renderers}
        compactIdentifiers={compactIdentifiers}
        onOpenAttempt={onOpenAttempt}
      />
    );
  }

  return (
    <PendingResult
      headingId={headingId}
      task={task}
      state={state}
      onOpenAttempt={onOpenAttempt}
    />
  );
}

function AcceptedResult({
  headingId,
  task,
  attempt,
  renderers,
  compactIdentifiers,
  onOpenAttempt,
}: {
  headingId: string;
  task: TaskSummary;
  attempt: TaskAttemptSummary;
  renderers?: readonly TaskOutputRenderer[];
  compactIdentifiers: boolean;
  onOpenAttempt?: (attemptN: number) => void;
}) {
  const theme = useTheme();
  const output = attempt.output;
  const context: TaskOutputRenderContext | null = output
    ? { task, attempt, output, compactIdentifiers }
    : null;
  const renderer = context
    ? resolveTaskOutputRenderer(context, renderers)
    : null;
  const summary = context && renderer ? renderer.summary(context) : null;
  const Body = renderer?.Body;
  const verification = readVerification(output);
  const criteriaDeclared = Boolean(
    (task.input as { successCriteria?: unknown }).successCriteria,
  );

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
                // Lead paragraph: one step up from body on phones, two on
                // wider screens; long summaries stay at the smaller size.
                fontSize:
                  summary.length > 480
                    ? theme.font.size.lg
                    : 'clamp(1.0625rem, 0.95rem + 0.5vw, 1.25rem)',
                lineHeight: 1.6,
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
                        compact={compactIdentifiers}
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
                    value: (
                      <Identifier
                        value={attempt.claimedByAgentId}
                        compact={compactIdentifiers}
                      />
                    ),
                  },
                  {
                    label: 'Executor fingerprint',
                    value:
                      attempt.completedExecutorFingerprint ??
                      attempt.claimedExecutorFingerprint ??
                      'Not attested',
                    mono: Boolean(
                      attempt.completedExecutorFingerprint ??
                      attempt.claimedExecutorFingerprint,
                    ),
                  },
                  ...(verification?.inputCid
                    ? [
                        {
                          label: 'Self-check pinned to input',
                          value: (
                            <Identifier
                              value={verification.inputCid}
                              compact={compactIdentifiers}
                            />
                          ),
                        },
                      ]
                    : []),
                ]}
              />
              {output ? (
                <Stack gap={1}>
                  <Text
                    as="h3"
                    variant="caption"
                    weight="semibold"
                    color="secondary"
                  >
                    Raw output
                  </Text>
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

function Identifier({
  value,
  compact,
  copyLabel,
}: {
  value: string;
  compact: boolean;
  copyLabel?: string;
}) {
  const theme = useTheme();
  return (
    <span
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: theme.spacing[2],
        maxWidth: '100%',
      }}
    >
      <span
        title={compact ? value : undefined}
        style={{ fontFamily: theme.font.family.mono, overflowWrap: 'anywhere' }}
      >
        {compact ? compactIdentifier(value) : value}
      </span>
      {copyLabel ? (
        <CopyButton value={value} text="Copy" size="sm" ariaLabel={copyLabel} />
      ) : null}
    </span>
  );
}

function PendingResult({
  headingId,
  task,
  state,
  onOpenAttempt,
}: {
  headingId: string;
  task: TaskSummary;
  state: Exclude<ResultState, { kind: 'accepted' }>;
  onOpenAttempt?: (attemptN: number) => void;
}) {
  const theme = useTheme();
  const copy = pendingCopy(task, state);
  const attempt = 'attempt' in state ? state.attempt : null;

  return (
    <ControlSurface as="section" aria-labelledby={headingId} padding="md">
      <Stack gap={3}>
        <Stack direction="row" align="center" gap={3} wrap>
          <Text as="h2" variant="h3" id={headingId}>
            Result
          </Text>
          <Badge variant={copy.tone}>{copy.badge}</Badge>
        </Stack>
        <Text style={{ maxWidth: '68ch' }}>{copy.title}</Text>
        {copy.detail ? (
          <Text
            variant="caption"
            color="secondary"
            style={{ maxWidth: '72ch' }}
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
): {
  badge: string;
  tone: 'default' | 'info' | 'warning' | 'error';
  title: ReactNode;
  detail?: ReactNode;
} {
  switch (state.kind) {
    case 'running': {
      const { attempt } = state;
      return {
        badge: humanizeToken(attempt.status),
        tone: 'info',
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
        badge: humanizeToken(attempt.status),
        tone: attempt.status === 'aborted' ? 'warning' : 'error',
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
        badge: humanizeToken(task.status),
        tone: task.status === 'expired' ? 'error' : 'warning',
        title:
          task.status === 'expired'
            ? `The task expired ${formatDateTime(task.expiresAt)} before any attempt was accepted.`
            : 'The task was cancelled before any attempt was accepted.',
        detail: task.cancelReason ? `Reason: ${task.cancelReason}` : undefined,
      };
    case 'pending':
      return {
        badge: humanizeToken(task.status),
        tone: task.status === 'waiting' ? 'warning' : 'default',
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
