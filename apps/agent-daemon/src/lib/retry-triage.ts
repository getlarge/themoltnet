import { type Api, getModel, type Model } from '@earendil-works/pi-ai';
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import type { Task, TaskError, TaskMessage } from '@moltnet/tasks';
import type { RuntimeProfileThinkingLevel } from '@moltnet/tasks';

export type RetryTriageDecision = 'retry' | 'do_not_retry';
export type RetryTriageConfidence = 'low' | 'medium' | 'high';

export interface RetryTriageResult {
  decision: RetryTriageDecision;
  confidence: RetryTriageConfidence;
  reason: string;
}

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
  source: 'explicit' | 'deterministic' | 'triage' | 'triage_failed';
  triage?: RetryTriageResult;
}

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
  const deterministic = classifyDeterministically(input.error);
  if (deterministic !== 'ambiguous') {
    return {
      error: { ...input.error, retryable: deterministic === 'retryable' },
      source:
        input.error.retryable === (deterministic === 'retryable')
          ? 'explicit'
          : 'deterministic',
    };
  }

  if (!input.triage) {
    return {
      error: { ...input.error, retryable: false },
      source: 'triage_failed',
    };
  }

  try {
    const triage = normalizeTriageResult(await input.triage(input));
    const retryable =
      triage.decision === 'retry' &&
      (triage.confidence === 'medium' || triage.confidence === 'high');
    return {
      error: {
        ...input.error,
        retryable,
        message: appendTriageReason(input.error.message, triage),
      },
      source: 'triage',
      triage,
    };
  } catch {
    return {
      error: { ...input.error, retryable: false },
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

export function createPiRetryTriage(options: {
  provider: string;
  model: string;
  thinkingLevel?: RuntimeProfileThinkingLevel | null;
  piAgentDir: string;
  timeoutMs?: number;
  cwd?: string;
}): RetryTriage {
  return async (input) => {
    const cwd = options.cwd ?? process.cwd();
    const getModelLoose = getModel as unknown as (
      provider: string,
      modelId: string,
    ) => Model<Api>;
    const modelHandle = getModelLoose(options.provider, options.model);
    const capture = createRetryTriageTool();
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: options.piAgentDir,
      appendSystemPrompt: [TRIAGE_SYSTEM_PROMPT],
      skillsOverride: () => ({ skills: [], diagnostics: [] }),
    });
    await resourceLoader.reload();
    const sessionManager = SessionManager.inMemory(cwd);
    const created = await createAgentSession({
      agentDir: options.piAgentDir,
      cwd,
      model: modelHandle,
      thinkingLevel: options.thinkingLevel ?? undefined,
      customTools: [capture.tool],
      sessionManager,
      resourceLoader,
    });

    await withTimeout(
      created.session.prompt(buildTriagePrompt(input)),
      options.timeoutMs ?? 30_000,
    );
    const result = capture.getCaptured();
    if (!result) {
      throw new Error('Retry triage did not submit a decision');
    }
    return normalizeTriageResult(result);
  };
}

function createRetryTriageTool(): {
  tool: ReturnType<typeof defineTool>;
  getCaptured: () => RetryTriageResult | null;
} {
  let captured: RetryTriageResult | null = null;
  const tool = defineTool({
    name: 'submit_retry_triage',
    label: 'Submit retry triage',
    description: 'Submit the retry decision for a failed MoltNet task attempt.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['decision', 'confidence', 'reason'],
      properties: {
        decision: { type: 'string', enum: ['retry', 'do_not_retry'] },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        reason: { type: 'string', minLength: 1 },
      },
    } as Parameters<typeof defineTool>[0]['parameters'],
    execute(_id, params) {
      captured = normalizeTriageResult(params);
      return Promise.resolve({
        content: [{ type: 'text' as const, text: 'Retry triage captured.' }],
        details: captured,
        terminate: true,
      });
    },
  });
  return { tool, getCaptured: () => captured };
}

function normalizeTriageResult(value: unknown): RetryTriageResult {
  const record =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const decision = record.decision === 'retry' ? 'retry' : 'do_not_retry';
  const confidence =
    record.confidence === 'high' || record.confidence === 'medium'
      ? record.confidence
      : 'low';
  const reason =
    typeof record.reason === 'string' && record.reason.trim()
      ? record.reason.trim().slice(0, 500)
      : 'retry triage did not provide a reason';
  return { decision, confidence, reason };
}

function appendTriageReason(
  message: string,
  triage: RetryTriageResult,
): string {
  const suffix = ` Retry triage: ${triage.decision}/${triage.confidence}: ${triage.reason}`;
  if (message.includes('Retry triage:')) return message;
  return `${message}${suffix}`.slice(0, 4000);
}

function buildTriagePrompt(input: RetryTriageInput): string {
  const payload = {
    task: {
      id: input.task.id,
      type: input.task.taskType,
      teamId: input.task.teamId,
      input: input.task.input,
    },
    attempt: {
      attemptN: input.attemptN,
      maxAttempts: input.maxAttempts ?? null,
      remainingAttempts: input.remainingAttempts ?? null,
    },
    error: input.error,
    recentMessages: (input.recentMessages ?? []).slice(-12),
  };
  return [
    'Classify whether this failed task attempt should be retried.',
    '',
    'Retry only when a fresh attempt can plausibly recover without changing the task input.',
    'Do not retry for policy, validation, credentials, cancellation, model/config, or task-contract failures.',
    'Use confidence=low when evidence is weak; low confidence must choose do_not_retry.',
    'Call submit_retry_triage exactly once.',
    '',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

const TRIAGE_SYSTEM_PROMPT = [
  'You are MoltNet retry triage.',
  'You classify one failed execution attempt, not the whole task.',
  'Return retry only for likely transient/runtime failures or clear evidence a new attempt can recover.',
  'The agent may have already tried local recovery; do not ask for more work.',
].join('\n');

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Retry triage timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
