import type {
  ExtensionAPI,
  ToolCallEvent,
  ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';
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

/** Minimal shape of the SDK method the resolver needs (keeps deps testable). */
export interface AllowedToolsClient {
  runtimeProfiles: {
    allowedTools: (
      profileId: string,
      options: { teamId: string },
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
   * Deadline for the allowed-tools fetch. A hung API call must not stall session
   * start-up indefinitely, so on timeout we abort and fall back to the
   * mode-appropriate degraded policy. Defaults to
   * {@link DEFAULT_RESOLVE_TIMEOUT_MS}; `0`/negative disables the deadline.
   */
  timeoutMs?: number;
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
    const resolved = await withTimeout(
      input.agent.runtimeProfiles.allowedTools(input.profileId, {
        teamId: input.teamId,
      }),
      timeoutMs,
    );
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

/**
 * Reject with {@link ToolPolicyResolveTimeoutError} if `promise` does not settle
 * within `timeoutMs`. A non-positive `timeoutMs` disables the deadline. The
 * underlying request is not cancelled — it is an idempotent GET whose result is
 * simply abandoned — but the timer is always cleared so it never keeps the
 * process alive.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (!(timeoutMs > 0)) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new ToolPolicyResolveTimeoutError(timeoutMs)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Map a pi `tool_call` event to a gate decision, extracting the shell command
 * for `bash` and delegating to {@link decideToolCall}.
 */
export function decideForEvent(
  event: ToolCallEvent,
  policy: SessionToolPolicy,
  analyze: ShellCommandAnalyzer['analyze'],
): GateDecision {
  const command =
    event.toolName === 'bash'
      ? (event.input as { command?: string }).command
      : undefined;
  return decideToolCall({
    toolName: event.toolName,
    command,
    enforcement: policy.enforcement,
    allowedTools: policy.allowedTools,
    allowedShellCommands: policy.allowedShellCommands,
    analyze,
  });
}

export interface ToolPolicyExtensionDeps {
  policy: SessionToolPolicy;
  analyzer: ShellCommandAnalyzer;
  logger: ToolPolicyLogger;
  context?: ToolPolicyDecisionContext;
  /**
   * Called for every refusal so it reaches the task record, not only the
   * daemon log. Pi's `tool_call` handler is synchronous, so this must not
   * block: implementations fire and forget.
   */
  onDecision?: (decision: ToolPolicyDecisionRecord) => void;
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

/** Correlation and claim evidence repeated on every tool-policy decision. */
export interface ToolPolicyDecisionContext {
  taskId: string;
  attemptN: number;
  teamId: string;
  claimantAgentId?: string;
  leaseId?: string;
  proposerKind?: 'agent' | 'human';
  proposerId?: string;
  claimRuntimeProfileId?: string;
  executionRuntimeProfileId?: string;
  claimRuntimeProfileRevision?: number;
  claimPolicySnapshotHash?: string;
  claimedExecutorFingerprint?: string;
}

/**
 * A pi extension factory that gates every `tool_call` against the resolved
 * policy. Blocks in `enforce`, audits (and allows) in `watch`, and is a no-op in
 * `off`. Register it in a session's `extensionFactories`.
 */
export function createToolPolicyExtension(deps: ToolPolicyExtensionDeps) {
  if (
    deps.context?.claimPolicySnapshotHash &&
    deps.policy.executionPolicySnapshotHash &&
    deps.context.claimPolicySnapshotHash !==
      deps.policy.executionPolicySnapshotHash
  ) {
    deps.logger.info(
      {
        ...decisionContext(deps),
        decision: 'continue',
        reason: 'claim_execution_policy_drift',
      },
      'tool_policy.snapshot_drift',
    );
  }

  return (pi: ExtensionAPI): void => {
    if (deps.policy.enforcement === 'off') return;

    pi.on('tool_call', (event): ToolCallEventResult | void => {
      const decision = decideForEvent(event, deps.policy, (command) =>
        deps.analyzer.analyze(command),
      );

      if ('allow' in decision && decision.allow) {
        deps.logger.info(
          {
            ...decisionContext(deps),
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            decision: 'allowed',
            reason: decision.reasonCode,
            ...(decision.matchedShellCommands?.length
              ? { shellFingerprints: decision.matchedShellCommands }
              : {}),
          },
          'tool_policy.allowed',
        );
        recordToolPolicyDecisionMetric({
          decision: 'allowed',
          reason: decision.reasonCode,
          enforcement: deps.policy.enforcement,
          degraded: deps.policy.degraded === true,
        });
        return;
      }

      if ('audit' in decision) {
        deps.logger.info(
          {
            ...decisionContext(deps),
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            decision: 'audit',
            reason: decision.reasonCode,
            ...(decision.missing?.length
              ? { unauthorizedExecutables: decision.missing }
              : {}),
            ...(decision.missingShellCommands?.length
              ? { shellFingerprints: decision.missingShellCommands }
              : {}),
          },
          'tool_policy.audit',
        );
        // The log says `audit`; the record says `would_block`, which states
        // the consequence rather than the mode that produced it.
        reportDecision(deps, 'would_block', event, decision);
        return;
      }

      deps.logger.warn(
        {
          ...decisionContext(deps),
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          decision: 'blocked',
          reason: decision.reasonCode,
          ...(decision.missing?.length
            ? { unauthorizedExecutables: decision.missing }
            : {}),
          ...(decision.missingShellCommands?.length
            ? { shellFingerprints: decision.missingShellCommands }
            : {}),
        },
        'tool_policy.blocked',
      );
      reportDecision(deps, 'blocked', event, decision);
      return { block: true, reason: decision.reason };
    });
  };
}

/**
 * Hand a refusal to {@link ToolPolicyExtensionDeps.onDecision}, never letting a
 * reporting failure change the gate's verdict.
 */
function reportDecision(
  deps: ToolPolicyExtensionDeps,
  decision: 'blocked' | 'would_block',
  event: { toolName: string; toolCallId?: string },
  gateDecision: GateDecision,
): void {
  recordToolPolicyDecisionMetric({
    decision,
    reason: gateDecision.reasonCode,
    enforcement: deps.policy.enforcement,
    degraded: deps.policy.degraded === true,
  });
  if (!deps.onDecision) {
    return;
  }
  const missing = 'missing' in gateDecision ? gateDecision.missing : undefined;
  const shell =
    'missingShellCommands' in gateDecision
      ? gateDecision.missingShellCommands
      : undefined;
  try {
    deps.onDecision({
      decision,
      tool_name: event.toolName,
      ...(event.toolCallId ? { tool_call_id: event.toolCallId } : {}),
      reason_code: gateDecision.reasonCode,
      enforcement: deps.policy.enforcement,
      ...(missing?.length ? { unauthorized_executables: missing } : {}),
      ...(shell?.length ? { shell_fingerprints: shell } : {}),
      degraded: deps.policy.degraded === true,
      ...(deps.policy.executionPolicySnapshotHash
        ? { policy_snapshot_hash: deps.policy.executionPolicySnapshotHash }
        : {}),
      ...(deps.policy.executionRuntimeProfileRevision !== undefined
        ? {
            runtime_profile_revision:
              deps.policy.executionRuntimeProfileRevision,
          }
        : {}),
    });
  } catch (error) {
    deps.logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'tool_policy.decision_report_failed',
    );
  }
}

function decisionContext(
  deps: ToolPolicyExtensionDeps,
): Record<string, unknown> {
  return {
    ...(deps.context ?? {}),
    enforcement: deps.policy.enforcement,
    degraded: deps.policy.degraded,
    executionPolicySnapshotHash: deps.policy.executionPolicySnapshotHash,
    executionRuntimeProfileRevision:
      deps.policy.executionRuntimeProfileRevision,
  };
}
