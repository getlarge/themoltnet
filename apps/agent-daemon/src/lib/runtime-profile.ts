import { accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute, resolve } from 'node:path';

import type { RuntimeProfileWorkspaceMode } from '@moltnet/tasks';
import type { SandboxConfig } from '@themoltnet/pi-extension';
import type { Agent } from '@themoltnet/sdk';

type RuntimeProfile = Awaited<ReturnType<Agent['runtimeProfiles']['get']>>;

export interface ResolvedRuntimeProfile {
  id: string;
  name: string;
  teamId: string;
  provider: string;
  model: string;
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
  sandboxConfig: SandboxConfig;
  mountPath: string;
  source: string;
}

export class RuntimeProfilePrerequisiteError extends Error {
  constructor(
    public readonly profileName: string,
    public readonly missingEnv: readonly string[],
    public readonly missingTools: readonly string[],
  ) {
    const parts = [
      missingEnv.length > 0 ? `missing env: ${missingEnv.join(', ')}` : null,
      missingTools.length > 0
        ? `missing tools: ${missingTools.join(', ')}`
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

  return {
    id: profile.id,
    name: profile.name,
    teamId: profile.teamId,
    provider: profile.provider,
    model: profile.model,
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
    'name' | 'requiredEnv' | 'requiredTools'
  >,
  env: NodeJS.ProcessEnv,
  pathValue: string,
): void {
  const missingEnv = profile.requiredEnv.filter((name) => !env[name]);
  const missingTools = profile.requiredTools.filter(
    (tool) => !isExecutableOnPath(tool, pathValue),
  );
  if (missingEnv.length > 0 || missingTools.length > 0) {
    throw new RuntimeProfilePrerequisiteError(
      profile.name,
      missingEnv,
      missingTools,
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
  return matches[0];
}

function isExecutableOnPath(
  tool: string,
  pathValue: string | undefined,
): boolean {
  if (tool.includes('/')) {
    return isExecutable(isAbsolute(tool) ? tool : resolve(process.cwd(), tool));
  }

  for (const dir of (pathValue ?? '').split(delimiter)) {
    if (!dir) continue;
    if (isExecutable(resolve(dir, tool))) return true;
  }
  return false;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
