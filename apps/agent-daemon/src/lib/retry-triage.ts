import type { Task, TaskError, TaskMessage } from '@moltnet/tasks';
import {
  normalizeRetryTriageResult,
  type PiRetryTriageResult,
  redactRetryTriageSecrets,
  type RetryTriageConfidence,
  type RetryTriageDecision,
} from '@themoltnet/pi-extension';

export type RetryTriageResult = PiRetryTriageResult;

export interface RetryTriageInput {
  task: Pick<Task, 'id' | 'taskType' | 'teamId' | 'input'>;
  attemptN: number;
  maxAttempts?: number | null;
  remainingAttempts?: number | null;
  error: TaskError;
  recentMessages?: Pick<TaskMessage, 'timestamp' | 'kind' | 'payload'>[];
}

export type RetryTriage = (
  input: RetryTriageInput,
) => Promise<RetryTriageResult>;

export interface ClassifiedAttemptFailure {
  error: TaskError;
  source:
    | 'explicit'
    | 'deterministic'
    | 'attempts_exhausted'
    | 'triage'
    | 'triage_failed';
  triage?: RetryTriageResult;
}

type RetrySource = ClassifiedAttemptFailure['source'];

const RETRYABLE_CODES = new Set([
  'checkpoint_upload_failed',
  'complete_call_failed',
  'daemon_abort',
  'dispatch_expired',
  'lease_expired',
  'llm_api_error',
  'runtime_session_checkpoint_failed',
  'session_prompt_failed',
]);

const NON_RETRYABLE_CODES = new Set([
  'bad_api_key',
  'invalid_api_key',
  'invalid_model',
  'output_rejected_by_server',
  'output_validation_failed',
  'producer_context_missing',
  'running_max_bash_timeouts_exceeded',
  'running_max_turns_exceeded',
  'task_cancelled',
  'unknown_task_type',
]);

const RETRYABLE_MESSAGE_PATTERNS = [
  /\b429\b/i,
  /\b5(?:02|03|04)\b/i,
  /\btimeout\b/i,
  /\btimed out\b/i,
  /\brate limit/i,
  /\btemporar(?:y|ily)\b/i,
  /\bunavailable\b/i,
  /\bECONNRESET\b/i,
  /\bECONNREFUSED\b/i,
  /\bETIMEDOUT\b/i,
  /\bENOTFOUND\b/i,
  /\bEAI_AGAIN\b/i,
  /\bDNS\b/i,
];

const NON_RETRYABLE_MESSAGE_PATTERNS = [
  /\b401\b/i,
  /\b403\b/i,
  /\bunauthori[sz]ed\b/i,
  /\bforbidden\b/i,
  /\binvalid (?:api )?key\b/i,
  /\bmissing credentials?\b/i,
  /\bmodel .*not (?:found|registered|available)\b/i,
  /\bunknown task type\b/i,
  /\bvalidation failed\b/i,
  /\bcancelled\b/i,
  /\bmax (?:turn|bash)/i,
];

export async function classifyAttemptFailure(
  input: RetryTriageInput & { triage?: RetryTriage },
): Promise<ClassifiedAttemptFailure> {
  if (
    input.remainingAttempts !== null &&
    input.remainingAttempts !== undefined
  ) {
    if (input.remainingAttempts <= 0) {
      return {
        error: withRetryInfo(input.error, {
          retryable: false,
          source: 'attempts_exhausted',
          reason: `Attempt budget exhausted at attempt ${input.attemptN}${
            input.maxAttempts ? ` of ${input.maxAttempts}` : ''
          }.`,
        }),
        source: 'attempts_exhausted',
      };
    }
  }

  const deterministic = classifyDeterministically(input.error);
  if (deterministic !== 'ambiguous') {
    const retryable = deterministic === 'retryable';
    const source =
      input.error.retryable === retryable ? 'explicit' : 'deterministic';
    return {
      error: withRetryInfo(input.error, {
        retryable,
        source,
        decision: retryable ? 'retry' : 'do_not_retry',
        confidence: 'high',
        reason: retryable
          ? 'Matched deterministic retry policy.'
          : 'Matched deterministic no-retry policy.',
      }),
      source,
    };
  }

  if (!input.triage) {
    return {
      error: withRetryInfo(input.error, {
        retryable: false,
        source: 'triage_failed',
        reason:
          'Failure was ambiguous and no retry triage agent was configured; defaulted to no retry.',
      }),
      source: 'triage_failed',
    };
  }

  try {
    const triage = normalizeRetryTriageResult(await input.triage(input));
    const retryable =
      triage.decision === 'retry' &&
      (triage.confidence === 'medium' || triage.confidence === 'high');
    return {
      error: withRetryInfo(
        {
          ...input.error,
          message: appendTriageReason(input.error.message, triage),
        },
        {
          retryable,
          source: 'triage',
          decision: triage.decision,
          confidence: triage.confidence,
          reason: triage.reason,
        },
      ),
      source: 'triage',
      triage,
    };
  } catch (err) {
    return {
      error: withRetryInfo(
        {
          ...input.error,
          message: appendTriageFailure(input.error.message, err),
        },
        {
          retryable: false,
          source: 'triage_failed',
          reason: `Retry triage failed: ${sanitizeReason(err)}`,
        },
      ),
      source: 'triage_failed',
    };
  }
}

export function classifyDeterministically(
  error: TaskError,
): 'retryable' | 'non_retryable' | 'ambiguous' {
  const code = error.code.toLowerCase();
  const message = error.message;

  if (NON_RETRYABLE_CODES.has(code)) return 'non_retryable';
  if (NON_RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'non_retryable';
  }
  if (RETRYABLE_CODES.has(code)) return 'retryable';
  if (RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'retryable';
  }
  if (error.retryable === true) return 'retryable';
  return 'ambiguous';
}

function appendTriageReason(
  message: string,
  triage: RetryTriageResult,
): string {
  const suffix = ` Retry triage: ${triage.decision}/${triage.confidence}: ${triage.reason}`;
  if (message.includes('Retry triage:')) return message;
  return `${message}${suffix}`.slice(0, 4000);
}

function appendTriageFailure(message: string, err: unknown): string {
  if (message.includes('Retry triage failed:')) return message;
  const sanitized = sanitizeReason(err);
  return `${message} Retry triage failed: ${sanitized}`.slice(0, 4000);
}

function sanitizeReason(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  return redactRetryTriageSecrets(raw).slice(0, 500);
}

function withRetryInfo(
  error: TaskError,
  info: {
    retryable: boolean;
    source: RetrySource;
    decision?: RetryTriageDecision;
    confidence?: RetryTriageConfidence;
    reason?: string;
  },
): TaskError {
  return {
    ...error,
    retryable: info.retryable,
    retry: {
      source: info.source,
      ...(info.decision ? { decision: info.decision } : {}),
      ...(info.confidence ? { confidence: info.confidence } : {}),
      ...(info.reason ? { reason: info.reason.slice(0, 500) } : {}),
    },
  };
}
