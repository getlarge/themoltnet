import { RecordTrace, Stack, Text } from '@themoltnet/design-system';
import type { ReactNode } from 'react';

import { formatDateTime, humanizeToken } from './format.js';
import type { TaskAttemptSummary, TaskSummary } from './types.js';

export interface TaskKnowledgeState {
  count: number | null;
  unavailable?: boolean;
}

export interface TaskExecutionRecordProps {
  task: TaskSummary;
  attempt?: TaskAttemptSummary | null;
  knowledge?: TaskKnowledgeState;
  attemptAction?: ReactNode;
  runtimeAction?: ReactNode;
  knowledgeAction?: ReactNode;
}

export function TaskExecutionRecord({
  task,
  attempt = null,
  knowledge,
  attemptAction,
  runtimeAction,
  knowledgeAction,
}: TaskExecutionRecordProps) {
  const result = resultState(task, attempt);
  const knowledgeStatus = getKnowledgeStatus(task, knowledge);

  return (
    <Stack gap={3}>
      <Stack gap={1}>
        <Text variant="h2">Execution record</Text>
        <Text color="secondary">
          The task contract, claimant, runtime authority, result, and retained
          knowledge remain attached to this record.
        </Text>
      </Stack>
      <RecordTrace
        ariaLabel="Task execution record"
        steps={[
          {
            id: 'contract',
            label: 'Contract',
            context: 'Task Engine',
            status: 'Sealed',
            statusTone: 'network',
            active: !attempt,
            details: [
              { label: 'Task type', value: humanizeToken(task.taskType) },
              { label: 'Input CID', value: task.inputCid, mono: true },
              {
                label: 'Executor trust',
                value: humanizeToken(task.requiredExecutorTrustLevel),
              },
            ],
          },
          {
            id: 'claim',
            label: 'Claim',
            context: 'Identity & Authority',
            status: attempt ? humanizeToken(attempt.status) : 'Awaiting claim',
            statusTone: attempt ? 'identity' : 'default',
            active: Boolean(attempt && !attempt.startedAt),
            details: attempt
              ? [
                  { label: 'Attempt', value: `#${attempt.attemptN}` },
                  {
                    label: 'Agent',
                    value: attempt.claimedByAgentId,
                    mono: true,
                  },
                  {
                    label: 'Executor',
                    value: attempt.claimedExecutorFingerprint ?? 'Not attested',
                    mono: Boolean(attempt.claimedExecutorFingerprint),
                  },
                ]
              : [{ label: 'Queued', value: formatDateTime(task.queuedAt) }],
            action: attemptAction,
          },
          {
            id: 'runtime',
            label: 'Runtime',
            context: 'Agent Runtime',
            status: runtimeStatus(attempt),
            statusTone: attempt?.startedAt ? 'network' : 'default',
            active: attempt?.status === 'running',
            details: [
              {
                label: 'Profile',
                value: runtimeProfile(attempt),
                mono: Boolean(attempt?.runtimeProfileId),
              },
              {
                label: 'Policy snapshot',
                value: attempt?.policySnapshotHash ?? 'Not recorded',
                mono: Boolean(attempt?.policySnapshotHash),
              },
              {
                label: 'Runtime ID',
                value: attempt?.runtimeId ?? 'Not started',
                mono: Boolean(attempt?.runtimeId),
              },
            ],
            action: runtimeAction,
          },
          {
            id: 'result',
            label: 'Result',
            context: 'Task Engine',
            status: result.label,
            statusTone: result.tone,
            details: [
              {
                label: 'Output CID',
                value: attempt?.outputCid ?? 'Not reported',
                mono: Boolean(attempt?.outputCid),
              },
              {
                label: 'Signature',
                value: attempt?.contentSignature ? 'Signed' : 'Not signed',
              },
              {
                label: 'Completed',
                value: formatDateTime(attempt?.completedAt ?? task.completedAt),
              },
            ],
          },
          {
            id: 'knowledge',
            label: 'Knowledge',
            context: 'Knowledge Factory',
            status: knowledgeStatus.label,
            statusTone: knowledgeStatus.tone,
            details: [
              {
                label: 'Diary',
                value: task.diaryId ?? 'Not configured',
                mono: Boolean(task.diaryId),
              },
              {
                label: 'Task entries',
                value:
                  knowledge?.count === null || knowledge?.count === undefined
                    ? 'Not loaded'
                    : String(knowledge.count),
              },
            ],
            action: knowledgeAction,
          },
        ]}
      />
    </Stack>
  );
}

function runtimeStatus(attempt?: TaskAttemptSummary | null) {
  if (!attempt) return 'Not started';
  if (!attempt.startedAt) return 'Claimed';
  if (attempt.status === 'running') return 'Running';
  return 'Recorded';
}

function runtimeProfile(attempt?: TaskAttemptSummary | null) {
  if (!attempt?.runtimeProfileId) return 'Not recorded';
  return attempt.runtimeProfileRevision
    ? `${attempt.runtimeProfileId}@${attempt.runtimeProfileRevision}`
    : attempt.runtimeProfileId;
}

function resultState(task: TaskSummary, attempt?: TaskAttemptSummary | null) {
  if (task.acceptedAttemptN === attempt?.attemptN) {
    return { label: 'Accepted', tone: 'success' as const };
  }
  if (attempt?.status === 'failed' || attempt?.status === 'timed_out') {
    return { label: 'Unsuccessful', tone: 'error' as const };
  }
  if (attempt?.status === 'cancelled' || attempt?.status === 'aborted') {
    return { label: 'Stopped', tone: 'warning' as const };
  }
  if (attempt?.outputCid) {
    return { label: 'Reported', tone: 'network' as const };
  }
  return { label: 'Pending', tone: 'default' as const };
}

function getKnowledgeStatus(task: TaskSummary, knowledge?: TaskKnowledgeState) {
  if (knowledge?.unavailable) {
    return { label: 'Unavailable', tone: 'warning' as const };
  }
  if (knowledge?.count) {
    return {
      label: `${knowledge.count} captured`,
      tone: 'success' as const,
    };
  }
  if (task.diaryId) {
    return { label: 'Diary ready', tone: 'identity' as const };
  }
  return { label: 'Not configured', tone: 'default' as const };
}
