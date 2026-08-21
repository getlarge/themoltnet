import { resolve } from 'node:path';

import {
  type RuntimeProfileContext,
  RuntimeProfileSandbox,
  type RuntimeProfileThinkingLevel,
  type RuntimeProfileToolEnforcement,
  type RuntimeProfileWorkspaceMode,
} from '@moltnet/runtime-profiles';
import type { Agent } from '@themoltnet/sdk';
import { Value } from 'typebox/value';

type RuntimeProfile = Awaited<ReturnType<Agent['runtimeProfiles']['get']>>;

export interface ResolvedRuntimeProfile {
  id: string;
  name: string;
  teamId: string;
  runtimeKind: string;
  definitionCid: string;
  provider: string;
  model: string;
  thinkingLevel: RuntimeProfileThinkingLevel | null;
  temperature: number | null;
  topP: number | null;
  topK: number | null;
  maxOutputTokens: number | null;
  leaseTtlSec: number;
  heartbeatIntervalMs: number;
  maxBatchSize: number;
  maxTurns: number;
  maxBashTimeouts: number;
  sessionTtlSec: number;
  workspaceTtlSec: number;
  defaultWorkspaceMode: RuntimeProfileWorkspaceMode | null;
  allowedWorkspaceModes: RuntimeProfileWorkspaceMode[];
  requiredEnv: string[];
  requiredTools: string[];
  requiredExecutables: string[];
  toolEnforcement: RuntimeProfileToolEnforcement;
  context: RuntimeProfileContext[];
  /**
   * The stored profile's sandbox declaration, validated against the
   * `RuntimeProfileSandbox` schema. Runtime-specific sandbox packages accept
   * it as a subset of their own config; this lib knows no runtime.
   */
  sandboxConfig: RuntimeProfileSandbox;
  mountPath: string;
  source: string;
}

export class RuntimeProfilePrerequisiteError extends Error {
  constructor(
    public readonly profileName: string,
    public readonly missingEnv: readonly string[],
    public readonly missingTools: readonly string[],
    public readonly missingExecutables: readonly string[],
  ) {
    const parts = [
      missingEnv.length > 0 ? `missing env: ${missingEnv.join(', ')}` : null,
      missingTools.length > 0
        ? `missing tools: ${missingTools.join(', ')}`
        : null,
      missingExecutables.length > 0
        ? `missing guest executables: ${missingExecutables.join(', ')}`
        : null,
    ].filter(Boolean);
    super(
      `Runtime profile "${profileName}" prerequisites are not satisfied: ${parts.join('; ')}`,
    );
    this.name = 'RuntimeProfilePrerequisiteError';
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolveRuntimeProfile(options: {
  agent: Agent;
  profile: string;
  teamId?: string;
  cwd: string;
}): Promise<ResolvedRuntimeProfile> {
  const profile = UUID_RE.test(options.profile)
    ? await options.agent.runtimeProfiles.get(options.profile)
    : await resolveProfileByName(options);

  if (options.teamId && profile.teamId !== options.teamId) {
    throw new Error(
      `Runtime profile "${options.profile}" belongs to team ${profile.teamId}, not ${options.teamId}.`,
    );
  }
  if (!Value.Check(RuntimeProfileSandbox, profile.sandbox)) {
    throw new Error(
      `Runtime profile "${profile.name}" contains unsupported sandbox fields.`,
    );
  }

  return {
    id: profile.id,
    name: profile.name,
    teamId: profile.teamId,
    runtimeKind: profile.runtimeKind,
    definitionCid: profile.definitionCid,
    provider: profile.provider,
    model: profile.model,
    thinkingLevel: profile.thinkingLevel ?? null,
    temperature: profile.temperature ?? null,
    topP: profile.topP ?? null,
    topK: profile.topK ?? null,
    maxOutputTokens: profile.maxOutputTokens ?? null,
    leaseTtlSec: profile.leaseTtlSec,
    heartbeatIntervalMs: profile.heartbeatIntervalMs,
    maxBatchSize: profile.maxBatchSize,
    maxTurns: profile.maxTurns,
    maxBashTimeouts: profile.maxBashTimeouts,
    sessionTtlSec: profile.sessionTtlSec,
    workspaceTtlSec: profile.workspaceTtlSec,
    defaultWorkspaceMode: profile.defaultWorkspaceMode ?? null,
    allowedWorkspaceModes: profile.allowedWorkspaceModes,
    requiredEnv: profile.requiredEnv,
    requiredTools: profile.requiredTools,
    requiredExecutables: profile.requiredExecutables,
    toolEnforcement: profile.toolEnforcement,
    context: profile.context ?? [],
    sandboxConfig: profile.sandbox,
    mountPath: resolve(options.cwd),
    source: `runtime-profile:${profile.id}`,
  };
}

export async function resolveRuntimeProfiles(options: {
  agent: Agent;
  profiles: readonly string[];
  teamId?: string;
  cwd: string;
}): Promise<ResolvedRuntimeProfile[]> {
  const seen = new Set<string>();
  const out: ResolvedRuntimeProfile[] = [];
  for (const profile of options.profiles) {
    const resolved = await resolveRuntimeProfile({
      agent: options.agent,
      profile,
      teamId: options.teamId,
      cwd: options.cwd,
    });
    if (seen.has(resolved.id)) continue;
    seen.add(resolved.id);
    out.push(resolved);
  }
  return out;
}

export function validateRuntimeProfilePrerequisites(
  profile: Pick<
    ResolvedRuntimeProfile,
    'name' | 'requiredEnv' | 'requiredTools' | 'requiredExecutables'
  >,
  env: NodeJS.ProcessEnv,
  inventory?: {
    tools?: readonly string[];
    executables?: readonly string[];
  },
): void {
  const missingEnv = profile.requiredEnv.filter((name) => !env[name]);
  const available = new Set(inventory?.tools ?? []);
  const executableInventory = new Set(inventory?.executables ?? []);
  const missingTools = profile.requiredTools.filter(
    (tool) => !available.has(tool),
  );
  const missingExecutables = profile.requiredExecutables.filter(
    (executable) => !executableInventory.has(executable),
  );
  if (
    missingEnv.length > 0 ||
    missingTools.length > 0 ||
    missingExecutables.length > 0
  ) {
    throw new RuntimeProfilePrerequisiteError(
      profile.name,
      missingEnv,
      missingTools,
      missingExecutables,
    );
  }
}

export function resolveProfileWarmSessionTtlSec(
  profile: Pick<ResolvedRuntimeProfile, 'sessionTtlSec' | 'workspaceTtlSec'>,
): number {
  return Math.min(profile.sessionTtlSec, profile.workspaceTtlSec);
}

async function resolveProfileByName(options: {
  agent: Agent;
  profile: string;
  teamId?: string;
}): Promise<RuntimeProfile> {
  if (!options.teamId) {
    throw new Error(
      `Runtime profile name "${options.profile}" requires --team. ` +
        'Use a profile UUID when running without a team-scoped list.',
    );
  }

  const profiles = await options.agent.runtimeProfiles.list({
    teamId: options.teamId,
  });
  const matches = profiles.items.filter(
    (item) => item.name === options.profile,
  );
  if (matches.length === 0) {
    throw new Error(
      `Runtime profile "${options.profile}" was not found in team ${options.teamId}.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Runtime profile name "${options.profile}" is ambiguous in team ${options.teamId}. ` +
        'Use the profile UUID instead.',
    );
  }
  const profile = matches[0] as RuntimeProfile & {
    thinkingLevel?: RuntimeProfileThinkingLevel | null;
    temperature?: number | null;
    topP?: number | null;
    topK?: number | null;
    maxOutputTokens?: number | null;
  };
  return {
    ...profile,
    thinkingLevel: profile.thinkingLevel ?? null,
    temperature: profile.temperature ?? null,
    topP: profile.topP ?? null,
    topK: profile.topK ?? null,
    maxOutputTokens: profile.maxOutputTokens ?? null,
  };
}
