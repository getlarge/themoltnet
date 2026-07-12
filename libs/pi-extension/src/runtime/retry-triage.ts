import type { Api, Model } from '@earendil-works/pi-ai';
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  SessionManager,
} from '@earendil-works/pi-coding-agent';

export type PiRetryTriageThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

export interface PiRetryTriageResult {
  decision: RetryTriageDecision;
  confidence: RetryTriageConfidence;
  reason: string;
}

export type RetryTriageDecision = 'retry' | 'do_not_retry';
export type RetryTriageConfidence = 'low' | 'medium' | 'high';
export type PiRetryTriageDecision = RetryTriageDecision;
export type PiRetryTriageConfidence = RetryTriageConfidence;

export interface PiRetryTriageInput {
  task: {
    id: string;
    taskType: string;
    teamId: string;
    input: unknown;
  };
  attemptN: number;
  maxAttempts?: number | null;
  remainingAttempts?: number | null;
  error: unknown;
  recentMessages?: {
    timestamp: string;
    kind: string;
    payload: unknown;
  }[];
}

export type PiRetryTriage = (
  input: PiRetryTriageInput,
) => Promise<PiRetryTriageResult>;

const MAX_TRIAGE_JSON_CHARS = 12_000;
const MAX_TRIAGE_FIELD_CHARS = 2_000;
const REDACTED = '[redacted]';

const SECRET_KEY_PATTERN =
  /(?:api[_-]?key|token|secret|password|passwd|credential|authorization|private[_-]?key|access[_-]?token|refresh[_-]?token)/i;

export function createPiRetryTriage(options: {
  model: Model<Api>;
  thinkingLevel?: PiRetryTriageThinkingLevel | null;
  piAgentDir: string;
  timeoutMs?: number;
  cwd?: string;
  systemPrompt?: string;
}): PiRetryTriage {
  return async (input) => {
    const cwd = options.cwd ?? process.cwd();
    const capture = createRetryTriageTool();
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: options.piAgentDir,
      appendSystemPrompt: [
        options.systemPrompt ?? DEFAULT_TRIAGE_SYSTEM_PROMPT,
      ],
      skillsOverride: () => ({ skills: [], diagnostics: [] }),
    });
    await resourceLoader.reload();
    const sessionManager = SessionManager.inMemory(cwd);
    const created = await createAgentSession({
      agentDir: options.piAgentDir,
      cwd,
      model: options.model,
      thinkingLevel: (options.thinkingLevel ?? undefined) as
        | NonNullable<Parameters<typeof createAgentSession>[0]>['thinkingLevel']
        | undefined,
      customTools: [capture.tool],
      sessionManager,
      resourceLoader,
    });

    await withTimeout(
      created.session.prompt(buildTriagePrompt(input)),
      options.timeoutMs ?? 30_000,
      () => created.session.abort(),
    );
    const result = capture.getCaptured();
    if (!result) {
      throw new Error('Retry triage did not submit a decision');
    }
    return normalizeRetryTriageResult(result);
  };
}

function createRetryTriageTool(): {
  tool: ReturnType<typeof defineTool>;
  getCaptured: () => PiRetryTriageResult | null;
} {
  let captured: PiRetryTriageResult | null = null;
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
      captured = normalizeRetryTriageResult(params);
      return Promise.resolve({
        content: [{ type: 'text' as const, text: 'Retry triage captured.' }],
        details: captured,
        terminate: true,
      });
    },
  });
  return { tool, getCaptured: () => captured };
}

export function normalizeRetryTriageResult(
  value: unknown,
): PiRetryTriageResult {
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

export function buildPiRetryTriagePromptForTest(
  input: PiRetryTriageInput,
): string {
  return buildTriagePrompt(input);
}

function buildTriagePrompt(input: PiRetryTriageInput): string {
  const payload = {
    task: {
      id: input.task.id,
      type: input.task.taskType,
      teamId: input.task.teamId,
      input: prepareTriagePayload(input.task.input),
    },
    attempt: {
      attemptN: input.attemptN,
      maxAttempts: input.maxAttempts ?? null,
      remainingAttempts: input.remainingAttempts ?? null,
    },
    error: prepareTriagePayload(input.error),
    recentMessages: prepareTriagePayload(
      (input.recentMessages ?? []).slice(-12),
    ),
  };
  return [
    'Classify whether this failed task attempt should be retried.',
    '',
    'Retry only when a fresh attempt can plausibly recover without changing the task input.',
    'Do not retry for policy, validation, credentials, cancellation, model/config, or task-contract failures.',
    'Submit-output validation errors should have been corrected inside the active Pi session; if one reaches retry triage, treat it as exhausted and choose do_not_retry.',
    'Use confidence=low when evidence is weak; low confidence must choose do_not_retry.',
    'Call submit_retry_triage exactly once.',
    '',
    truncateString(JSON.stringify(payload, null, 2), MAX_TRIAGE_JSON_CHARS),
  ].join('\n');
}

function prepareTriagePayload(value: unknown): unknown {
  return redactAndTruncate(value, []);
}

function redactAndTruncate(value: unknown, path: string[]): unknown {
  const currentKey = path[path.length - 1] ?? '';
  if (SECRET_KEY_PATTERN.test(currentKey)) return REDACTED;
  if (typeof value === 'string') {
    return truncateString(
      redactRetryTriageSecrets(value),
      MAX_TRIAGE_FIELD_CHARS,
    );
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      redactAndTruncate(item, [...path, String(index)]),
    );
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, child]) => [key, redactAndTruncate(child, [...path, key])],
    );
    return Object.fromEntries(entries);
  }
  return value;
}

export function redactRetryTriageSecrets(value: string): string {
  return value
    .replace(/((?:bearer|basic)\s+)[a-z0-9._~+/=-]{16,}/gi, `$1${REDACTED}`)
    .replace(/\bgh[pousr]_[a-z0-9_]{20,}\b/gi, REDACTED)
    .replace(/\bsk-[a-z0-9_-]{16,}\b/gi, REDACTED)
    .replace(
      /\beyJ[a-z0-9_-]{20,}\.[a-z0-9_-]{20,}\.[a-z0-9_-]{20,}\b/gi,
      REDACTED,
    );
}

function truncateString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...[truncated ${value.length - maxChars} chars]`;
}

const DEFAULT_TRIAGE_SYSTEM_PROMPT = [
  'You are MoltNet retry triage.',
  'You classify one failed execution attempt, not the whole task.',
  'Return retry only for likely transient/runtime failures or clear evidence a new attempt can recover.',
  'The agent may have already tried local recovery; do not ask for more work.',
].join('\n');

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void | Promise<void>,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      void Promise.resolve(onTimeout?.()).catch(() => {
        // Best effort: the caller still gets the timeout signal below.
      });
      reject(new Error(`Retry triage timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
