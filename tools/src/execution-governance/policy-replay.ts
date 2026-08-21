import { readFile } from 'node:fs/promises';

import {
  decideToolCall,
  type GateDecision,
  type GateInput,
  type ToolEnforcement,
} from '@themoltnet/pi-runtime';
import { ShellCommandAnalyzer } from '@themoltnet/shell-command-analyzer';

export type ReplayProvider = 'claude' | 'codex';

export interface AllowedToolsResponseFixture {
  enforcement: ToolEnforcement;
  allowedShellCommands: string[][];
  allowedTools: string[];
  runtimeKind: string;
  runtimeProfileRevision: number;
  policySnapshotHash: string;
}

export interface ReplayPayload {
  hook_event_name: string;
  session_id: string;
  tool_input?: Record<string, unknown>;
  tool_name: string;
  tool_use_id: string;
}

export interface PolicyReplayFixture {
  allowedToolsResponse: AllowedToolsResponseFixture;
  retainedPayloads: Record<ReplayProvider, { shell: string; mcp: string }>;
}

interface ProviderPreToolUseDenial {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'deny';
    permissionDecisionReason: GateDecision['reasonCode'];
  };
}

export type ProviderPreToolUseResponse =
  | Record<string, never>
  | ProviderPreToolUseDenial;

export interface ReplayEvidence {
  runtimeProfileRevision: number;
  policySnapshotHash: string;
  provider: ReplayProvider;
  nativeActionIdentifier: string;
  decision: 'allow' | 'deny' | 'audit';
  reasonCode: GateDecision['reasonCode'];
  decisionLocus: 'offline-replay';
  intendedEnforcementLocus: 'PreToolUse';
  enforcementObserved: false;
  hookResponse: ProviderPreToolUseResponse;
}

export async function loadPolicyReplayFixture(
  path: string,
): Promise<PolicyReplayFixture> {
  const fixture = JSON.parse(
    await readFile(path, 'utf8'),
  ) as Partial<PolicyReplayFixture>;
  assertAllowedToolsResponseFixture(fixture.allowedToolsResponse);
  if (!fixture.retainedPayloads) {
    throw new Error('policy replay fixture lacks retained payloads');
  }
  return fixture as PolicyReplayFixture;
}

export async function loadRetainedPreToolUse(
  path: string,
  toolName: string,
): Promise<ReplayPayload> {
  const lines = (await readFile(path, 'utf8')).trim().split('\n');
  for (const line of lines) {
    const payload = JSON.parse(line) as Partial<ReplayPayload>;
    if (
      payload.hook_event_name !== 'PreToolUse' ||
      payload.tool_name !== toolName
    ) {
      continue;
    }
    if (
      typeof payload.session_id !== 'string' ||
      typeof payload.tool_name !== 'string' ||
      typeof payload.tool_use_id !== 'string'
    ) {
      throw new Error('retained PreToolUse payload lacks native identifiers');
    }
    return payload as ReplayPayload;
  }
  throw new Error(
    `retained evidence has no PreToolUse payload for ${toolName}`,
  );
}

export async function launchAfterPolicyResolution(
  resolvePolicy: () => Promise<AllowedToolsResponseFixture | undefined>,
  launch: (policy: AllowedToolsResponseFixture) => Promise<void>,
): Promise<void> {
  const policy = await resolvePolicy();
  if (!policy) {
    throw new Error('runtime policy resolution unavailable');
  }
  await launch(policy);
}

export async function replayPreToolUse(
  provider: ReplayProvider,
  payload: ReplayPayload,
  policy: AllowedToolsResponseFixture,
): Promise<ReplayEvidence> {
  const normalized = normalizePreToolUse(payload);
  const analyzer = await ShellCommandAnalyzer.create();
  const decision = decideToolCall({
    ...normalized,
    enforcement: policy.enforcement,
    allowedTools: new Set(policy.allowedTools),
    allowedShellCommands: normalizeShellRules(policy.allowedShellCommands),
    analyze: (command) => analyzer.analyze(command),
  });

  return {
    runtimeProfileRevision: policy.runtimeProfileRevision,
    policySnapshotHash: policy.policySnapshotHash,
    provider,
    nativeActionIdentifier: payload.tool_use_id,
    decision: toEvidenceDecision(decision),
    reasonCode: decision.reasonCode,
    decisionLocus: 'offline-replay',
    intendedEnforcementLocus: 'PreToolUse',
    enforcementObserved: false,
    hookResponse: translateProviderPreToolUseDecision(provider, decision),
  };
}

function assertAllowedToolsResponseFixture(
  value: unknown,
): asserts value is AllowedToolsResponseFixture {
  if (!value || typeof value !== 'object') {
    throw new Error('policy replay fixture lacks an allowed-tools response');
  }
  const policy = value as Partial<AllowedToolsResponseFixture>;
  if (
    typeof policy.runtimeKind !== 'string' ||
    policy.runtimeKind.length === 0
  ) {
    throw new Error('allowed-tools response lacks runtimeKind');
  }
  if (
    !Number.isInteger(policy.runtimeProfileRevision) ||
    (policy.runtimeProfileRevision ?? 0) < 1
  ) {
    throw new Error(
      'allowed-tools response has invalid runtimeProfileRevision',
    );
  }
  if (
    !Array.isArray(policy.allowedTools) ||
    !Array.isArray(policy.allowedShellCommands) ||
    !['off', 'watch', 'enforce'].includes(policy.enforcement ?? '') ||
    !/^sha256:[0-9a-f]{64}$/.test(policy.policySnapshotHash ?? '')
  ) {
    throw new Error('allowed-tools response does not match the replay fixture');
  }
}

function normalizePreToolUse(payload: ReplayPayload): {
  toolName: string;
  command?: string;
} {
  if (payload.hook_event_name !== 'PreToolUse') {
    throw new Error('policy replay only accepts PreToolUse payloads');
  }
  const command = payload.tool_input?.command;
  if (payload.tool_name === 'Bash') {
    if (typeof command !== 'string') {
      throw new Error('Bash PreToolUse payload lacks a command');
    }
    return { toolName: 'bash', command };
  }
  return { toolName: payload.tool_name };
}

function normalizeShellRules(
  rules: string[][],
): GateInput['allowedShellCommands'] {
  return rules.map((argvPrefix) => {
    if (
      argvPrefix.length < 2 ||
      argvPrefix.some((token) => typeof token !== 'string')
    ) {
      throw new Error(
        'allowed shell command requires at least two argv tokens',
      );
    }
    return {
      argvPrefix: argvPrefix as [string, string, ...string[]],
    };
  });
}

function toEvidenceDecision(
  decision: GateDecision,
): ReplayEvidence['decision'] {
  if ('audit' in decision) return 'audit';
  return decision.allow ? 'allow' : 'deny';
}

function translateProviderPreToolUseDecision(
  provider: ReplayProvider,
  decision: GateDecision,
): ProviderPreToolUseResponse {
  if (toEvidenceDecision(decision) !== 'deny') return {};

  const denial: ProviderPreToolUseDenial = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: decision.reasonCode,
    },
  };
  // Both providers currently document this denial shape. Keep the provider
  // branch explicit so a future provider-specific delta cannot be mistaken for
  // a change to the shared MoltNet gate.
  switch (provider) {
    case 'claude':
      return denial;
    case 'codex':
      return denial;
  }
}
