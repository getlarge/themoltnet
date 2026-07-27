import type {
  ExtensionAPI,
  ToolCallEvent,
  ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';
import type { ShellCommandAnalyzer } from '@themoltnet/shell-command-analyzer';

import {
  decideToolCall,
  type GateDecision,
  type ToolEnforcement,
} from './gate.js';

/** The resolved allow-set + enforcement mode for a runtime session. */
export interface SessionToolPolicy {
  enforcement: ToolEnforcement;
  allowedTools: ReadonlySet<string>;
}

interface Logger {
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
    ) => Promise<{ enforcement: ToolEnforcement; allowedTools: string[] }>;
  };
}

export interface ResolveSessionToolPolicyInput {
  agent: AllowedToolsClient;
  profileId: string;
  teamId: string;
  /**
   * The profile's enforcement mode, already known to the daemon from the
   * resolved runtime profile. Used to decide fail-open vs fail-closed when the
   * allowed-tools fetch fails.
   */
  enforcement: ToolEnforcement;
  logger: Logger;
}

/**
 * Resolve the session's tool policy at start-up.
 *
 * `off` short-circuits without a network call. Otherwise the allowed-tool set
 * is fetched from the API. If that fetch fails, the mode decides the fallback:
 * `enforce` **fails closed** (empty allow-set → every non-`off` tool is
 * blocked); `watch` fails open (empty allow-set → every tool is audited but
 * allowed).
 */
export async function resolveSessionToolPolicy(
  input: ResolveSessionToolPolicyInput,
): Promise<SessionToolPolicy> {
  if (input.enforcement === 'off') {
    return { enforcement: 'off', allowedTools: new Set() };
  }

  try {
    const resolved = await input.agent.runtimeProfiles.allowedTools(
      input.profileId,
      { teamId: input.teamId },
    );
    return {
      enforcement: resolved.enforcement,
      allowedTools: new Set(resolved.allowedTools),
    };
  } catch (err) {
    input.logger.warn(
      {
        err,
        profileId: input.profileId,
        teamId: input.teamId,
        enforcement: input.enforcement,
        failClosed: input.enforcement === 'enforce',
      },
      'tool_policy.resolve_failed',
    );
    // Fail closed in enforce (empty allow-set blocks everything); in watch the
    // empty set audits every call but proceeds.
    return { enforcement: input.enforcement, allowedTools: new Set() };
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
    analyze,
  });
}

export interface ToolPolicyExtensionDeps {
  policy: SessionToolPolicy;
  analyzer: ShellCommandAnalyzer;
  logger: Logger;
}

/**
 * A pi extension factory that gates every `tool_call` against the resolved
 * policy. Blocks in `enforce`, audits (and allows) in `watch`, and is a no-op in
 * `off`. Register it in a session's `extensionFactories`.
 */
export function createToolPolicyExtension(deps: ToolPolicyExtensionDeps) {
  return (pi: ExtensionAPI): void => {
    if (deps.policy.enforcement === 'off') return;

    pi.on('tool_call', (event): ToolCallEventResult | void => {
      const decision = decideForEvent(event, deps.policy, (command) =>
        deps.analyzer.analyze(command),
      );

      if ('allow' in decision && decision.allow) return;

      if ('audit' in decision) {
        deps.logger.info(
          { toolName: event.toolName, toolCallId: event.toolCallId, decision },
          'tool_policy.audit',
        );
        return;
      }

      deps.logger.warn(
        {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          reason: decision.reason,
        },
        'tool_policy.blocked',
      );
      return { block: true, reason: decision.reason };
    });
  };
}
