import { isTransientMoltNetError } from '@themoltnet/sdk';
import type { ShellCommandAnalyzer } from '@themoltnet/shell-command-analyzer';

import {
  decideToolCall,
  type GateDecision,
  type MissingShellCommand,
  type ShellCommandRule,
  type ToolEnforcement,
  type ToolPolicyDecisionReason,
} from './gate.js';
import { recordToolPolicyDecisionMetric } from './telemetry.js';

/** The resolved allow-set + enforcement mode for a runtime session. */
export interface SessionToolPolicy {
  enforcement: ToolEnforcement;
  allowedTools: ReadonlySet<string>;
  allowedShellCommands: readonly ShellCommandRule[];
  /** Latest effective policy hash resolved for this Pi session. */
  executionPolicySnapshotHash?: string;
  /** Latest runtime profile revision resolved with the session policy. */
  executionRuntimeProfileRevision?: number;
  /**
   * `true` when the allow-set is a **degraded fallback** — the allowed-tools
   * fetch failed or timed out and this policy is the fail-closed/fail-open
   * default, NOT the operator's actual configuration. An intentional
   * empty-but-resolved policy (e.g. a profile with no bound tools) has
   * `degraded: false`. Surfaced in every audit/block log so an operator can tell
   * "blocked because the policy is empty" from "blocked because we couldn't read
   * the policy". Successful resolutions are never degraded.
   */
  degraded: boolean;
}

/** Default deadline for the allowed-tools fetch before we fall back. */
export const DEFAULT_RESOLVE_TIMEOUT_MS = 5_000;
/** Backoff before each retry of a transiently failed allowed-tools fetch. */
const RESOLVE_RETRY_DELAYS_MS = [250, 1_000] as const;

/**
 * Structured logger the resolver and gate emit to. Deliberately the pino
 * `(obj, msg)` shape so the daemon can pass a task-bound pino child directly —
 * every tool-policy line then carries the daemon's taskId/attemptN context and
 * lands in the same NDJSON stream as the rest of the run.
 */
export interface ToolPolicyLogger {
  debug: (obj: Record<string, unknown>, msg: string) => void;
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

/** JSON lines on stderr, for callers that did not inject a logger. */
export function createStderrToolPolicyLogger(
  bindings: Record<string, unknown> = {},
): ToolPolicyLogger {
  const write =
    (level: 'info' | 'warn') => (obj: Record<string, unknown>, msg: string) =>
      console.error(JSON.stringify({ level, msg, ...bindings, ...obj }));
  return { debug: () => {}, info: write('info'), warn: write('warn') };
}

/** Minimal shape of the SDK method the resolver needs (keeps deps testable). */
export interface AllowedToolsClient {
  runtimeProfiles: {
    allowedTools: (
      profileId: string,
      options: { teamId: string; signal?: AbortSignal },
    ) => Promise<{
      enforcement: ToolEnforcement;
      allowedTools: string[];
      allowedShellCommands: Array<{ argvPrefix: string[] }>;
      runtimeKind: string;
      policySnapshotHash?: string;
      runtimeProfileRevision?: number;
    }>;
  };
}

export interface ResolveSessionToolPolicyInput {
  agent: AllowedToolsClient;
  profileId: string;
  teamId: string;
  /** Runtime kind supplied by the trusted daemon adapter for this session. */
  runtimeKind: string;
  /**
   * The profile's enforcement mode, already known to the daemon from the
   * resolved runtime profile. Used to decide fail-open vs fail-closed when the
   * allowed-tools fetch fails.
   */
  enforcement: ToolEnforcement;
  logger: ToolPolicyLogger;
  /**
   * Deadline per allowed-tools fetch. A timed-out, transport-failed or
   * 408/429/5xx GET is cancelled and retried up to twice with backoff. After
   * the last attempt fails, return the mode-appropriate degraded policy.
   * Defaults to
   * {@link DEFAULT_RESOLVE_TIMEOUT_MS}; `0`/negative disables the deadline.
   */
  timeoutMs?: number;
  /** Cancels policy resolution when the task or writer stops. */
  signal?: AbortSignal;
}

/**
 * Resolve the session's tool policy at start-up.
 *
 * The latest allowed-tool set and enforcement mode are fetched from the API,
 * including when the daemon's cached profile says `off`. If that fetch fails,
 * the cached mode decides the fallback:
 * `enforce` **fails closed** (empty allow-set → every non-`off` tool is
 * blocked); `watch` fails open (empty allow-set → every tool is audited but
 * allowed).
 *
 * The result is a **session-start snapshot**: it is resolved once and cached for
 * the session's lifetime. Policy edits made while a task is running do not take
 * effect until the next session — a deliberate trade-off (one resolution per
 * session, stable enforcement for the run) accepted over re-fetching per call.
 */
export async function resolveSessionToolPolicy(
  input: ResolveSessionToolPolicyInput,
): Promise<SessionToolPolicy> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_RESOLVE_TIMEOUT_MS;
  try {
    const fetchPolicy = () =>
      withTimeout(
        (signal) =>
          input.agent.runtimeProfiles.allowedTools(input.profileId, {
            teamId: input.teamId,
            signal,
          }),
        timeoutMs,
        input.signal,
      );
    // A transient upstream failure must not permanently fail a claimed task.
    // Retry a local deadline, a transport failure, or HTTP 408/429/5xx with a
    // short backoff, after cancelling the failed request. Auth, policy errors
    // and caller cancellation remain fail-closed immediately.
    let resolved: Awaited<ReturnType<typeof fetchPolicy>> | undefined;
    for (let attempt = 1; !resolved; attempt += 1) {
      try {
        resolved = await fetchPolicy();
      } catch (error) {
        const transient =
          error instanceof ToolPolicyResolveTimeoutError ||
          isTransientMoltNetError(error);
        if (
          !transient ||
          input.signal?.aborted ||
          attempt > RESOLVE_RETRY_DELAYS_MS.length
        )
          throw error;
        const delayMs = RESOLVE_RETRY_DELAYS_MS[attempt - 1];
        input.logger.warn(
          {
            profileId: input.profileId,
            timeoutMs,
            attempt,
            delayMs,
            timedOut: error instanceof ToolPolicyResolveTimeoutError,
          },
          'tool_policy.resolve_retry',
        );
        await delay(delayMs, input.signal);
      }
    }
    const shellCommands = resolved.allowedShellCommands ?? [];
    if (resolved.runtimeKind !== input.runtimeKind) {
      throw new RuntimeKindMismatchError({
        expectedRuntimeKind: input.runtimeKind,
        receivedRuntimeKind: resolved.runtimeKind,
      });
    }
    return {
      enforcement: resolved.enforcement,
      allowedTools: new Set(resolved.allowedTools),
      allowedShellCommands: shellCommands.map((rule) => {
        if (
          rule.argvPrefix.length < 1 ||
          rule.argvPrefix.length > 8 ||
          rule.argvPrefix.some((token) => !token)
        ) {
          throw new Error('runtime returned an invalid shell command rule');
        }
        return {
          argvPrefix: rule.argvPrefix as [string, ...string[]],
        };
      }),
      executionPolicySnapshotHash: resolved.policySnapshotHash,
      executionRuntimeProfileRevision: resolved.runtimeProfileRevision,
      degraded: false,
    };
  } catch (err) {
    input.logger.warn(
      {
        err,
        profileId: input.profileId,
        teamId: input.teamId,
        enforcement: input.enforcement,
        timedOut: err instanceof ToolPolicyResolveTimeoutError,
        failClosed: input.enforcement === 'enforce',
      },
      'tool_policy.resolve_failed',
    );
    // Degraded fallback. Fail closed in enforce (empty allow-set blocks
    // everything); in watch the empty set audits every call but proceeds. The
    // `degraded` flag lets the gate distinguish this from a resolved-empty
    // policy in its audit/block logs.
    return {
      enforcement: input.enforcement,
      allowedTools: new Set(),
      allowedShellCommands: [],
      degraded: true,
    };
  }
}

/** Thrown when the allowed-tools fetch exceeds its deadline. */
export class ToolPolicyResolveTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`tool-policy resolution timed out after ${timeoutMs}ms`);
    this.name = 'ToolPolicyResolveTimeoutError';
  }
}

export class RuntimeKindMismatchError extends Error {
  constructor(input: {
    expectedRuntimeKind: string;
    receivedRuntimeKind: string;
  }) {
    super(
      `runtime kind mismatch: expected ${input.expectedRuntimeKind}, ` +
        `received ${input.receivedRuntimeKind}`,
    );
    this.name = 'RuntimeKindMismatchError';
  }
}

/** Sleep between retries, ending early with the abort reason. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error('Policy resolution cancelled'),
      );
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Bound and cancel each GET, even when a client fails to honor abort. */
async function withTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal,
): Promise<T> {
  parent?.throwIfAborted();
  const controller = new AbortController();
  const signal = parent
    ? AbortSignal.any([parent, controller.signal])
    : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () =>
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error('Policy resolution cancelled'),
      );
    signal.addEventListener('abort', onAbort, { once: true });
    if (timeoutMs > 0)
      timer = setTimeout(
        () => controller.abort(new ToolPolicyResolveTimeoutError(timeoutMs)),
        timeoutMs,
      );
  });
  try {
    return await Promise.race([request(signal), aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * A refusal, shaped for the task record. Carries no argv literals: the
 * executables and the fingerprint identify an invocation without reproducing
 * its arguments, which is what lets this reach a persisted, readable record
 * with no redaction rule.
 */
export interface ToolPolicyDecisionRecord {
  /** `blocked` in enforce, `would_block` in watch. */
  decision: 'blocked' | 'would_block';
  tool_name: string;
  tool_call_id?: string;
  reason_code: ToolPolicyDecisionReason;
  enforcement: ToolEnforcement;
  /** Executables the policy did not authorize. */
  unauthorized_executables?: string[];
  /** Literal-free identification of each refused shell invocation. */
  shell_fingerprints?: MissingShellCommand[];
  degraded: boolean;
  policy_snapshot_hash?: string;
  runtime_profile_revision?: number;
}

function toolPolicyDecisionRecord(
  policy: SessionToolPolicy,
  decision: 'blocked' | 'would_block',
  event: { toolName: string },
  gateDecision: GateDecision,
): ToolPolicyDecisionRecord {
  const missing = 'missing' in gateDecision ? gateDecision.missing : undefined;
  const shell =
    'missingShellCommands' in gateDecision
      ? gateDecision.missingShellCommands
      : undefined;
  return {
    decision,
    tool_name: event.toolName,
    reason_code: gateDecision.reasonCode,
    enforcement: policy.enforcement,
    ...(missing?.length ? { unauthorized_executables: missing } : {}),
    ...(shell?.length ? { shell_fingerprints: shell } : {}),
    degraded: policy.degraded === true,
    ...(policy.executionPolicySnapshotHash
      ? { policy_snapshot_hash: policy.executionPolicySnapshotHash }
      : {}),
    ...(policy.executionRuntimeProfileRevision !== undefined
      ? { runtime_profile_revision: policy.executionRuntimeProfileRevision }
      : {}),
  };
}

/**
 * Decide one Durable tool call. Returns the block reason, or `undefined` when
 * the call may run. Durable authorizes from an async hook, so a refusal is
 * reported before the verdict returns instead of through a drained sink; a
 * reporting failure is logged and never changes the verdict.
 */
export async function authorizeDurableToolCall(input: {
  policy: SessionToolPolicy;
  analyze: ShellCommandAnalyzer['analyze'];
  logger: ToolPolicyLogger;
  context: { taskId: string; attemptN: number };
  toolName: string;
  args: Record<string, unknown>;
  onDecision(record: ToolPolicyDecisionRecord): Promise<void>;
}): Promise<string | undefined> {
  const { policy } = input;
  const decision = decideToolCall({
    enforcement: policy.enforcement,
    allowedTools: policy.allowedTools,
    allowedShellCommands: policy.allowedShellCommands,
    toolName: input.toolName,
    command:
      typeof input.args.command === 'string' ? input.args.command : undefined,
    analyze: input.analyze,
  });
  const outcome =
    'audit' in decision
      ? 'would_block'
      : 'allow' in decision && !decision.allow
        ? 'blocked'
        : 'allowed';
  // Event names and fields predate Durable; dashboards depend on them.
  const fields = {
    ...input.context,
    enforcement: policy.enforcement,
    degraded: policy.degraded,
    executionPolicySnapshotHash: policy.executionPolicySnapshotHash,
    executionRuntimeProfileRevision: policy.executionRuntimeProfileRevision,
    toolName: input.toolName,
    decision: outcome === 'would_block' ? 'audit' : outcome,
    reason: decision.reasonCode,
    ...('matchedShellCommands' in decision &&
    decision.matchedShellCommands?.length
      ? { shellFingerprints: decision.matchedShellCommands }
      : {}),
    ...('missing' in decision && decision.missing?.length
      ? { unauthorizedExecutables: decision.missing }
      : {}),
  };
  if (outcome === 'blocked') input.logger.warn(fields, 'tool_policy.blocked');
  else
    input.logger.info(
      fields,
      outcome === 'allowed' ? 'tool_policy.allowed' : 'tool_policy.audit',
    );
  recordToolPolicyDecisionMetric({
    decision: outcome,
    reason: decision.reasonCode,
    enforcement: policy.enforcement,
    degraded: policy.degraded === true,
  });
  if (outcome !== 'allowed') {
    try {
      await input.onDecision(
        toolPolicyDecisionRecord(
          policy,
          outcome,
          { toolName: input.toolName },
          decision,
        ),
      );
    } catch (error) {
      input.logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'tool_policy.decision_report_failed',
      );
    }
  }
  return 'allow' in decision && !decision.allow ? decision.reason : undefined;
}
