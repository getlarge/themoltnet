import { accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute, resolve } from 'node:path';

import type { SandboxConfig } from '@themoltnet/pi-extension';
import type { Agent } from '@themoltnet/sdk';

type DaemonProfile = Awaited<ReturnType<Agent['daemonProfiles']['get']>>;

export interface ResolvedDaemonProfile {
  id: string;
  name: string;
  teamId: string;
  provider: string;
  model: string;
  leaseTtlSec: number;
  heartbeatIntervalMs: number;
  maxBatchSize: number;
  sessionTtlSec: number;
  workspaceTtlSec: number;
  requiredEnv: string[];
  requiredTools: string[];
  sandboxConfig: SandboxConfig;
  mountPath: string;
  source: string;
}

export class DaemonProfilePrerequisiteError extends Error {
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
      `Daemon profile "${profileName}" prerequisites are not satisfied: ${parts.join('; ')}`,
    );
    this.name = 'DaemonProfilePrerequisiteError';
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolveDaemonProfile(options: {
  agent: Agent;
  profile: string;
  teamId?: string;
  cwd: string;
}): Promise<ResolvedDaemonProfile> {
  const profile = UUID_RE.test(options.profile)
    ? await options.agent.daemonProfiles.get(options.profile)
    : await resolveProfileByName(options);

  if (options.teamId && profile.teamId !== options.teamId) {
    throw new Error(
      `Daemon profile "${options.profile}" belongs to team ${profile.teamId}, not ${options.teamId}.`,
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
    sessionTtlSec: profile.sessionTtlSec,
    workspaceTtlSec: profile.workspaceTtlSec,
    requiredEnv: profile.requiredEnv,
    requiredTools: profile.requiredTools,
    sandboxConfig: profile.sandbox,
    mountPath: resolve(options.cwd),
    source: `daemon-profile:${profile.id}`,
  };
}

export function validateDaemonProfilePrerequisites(
  profile: Pick<
    ResolvedDaemonProfile,
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
    throw new DaemonProfilePrerequisiteError(
      profile.name,
      missingEnv,
      missingTools,
    );
  }
}

export function resolveProfileWarmSessionTtlSec(
  profile: Pick<ResolvedDaemonProfile, 'sessionTtlSec' | 'workspaceTtlSec'>,
): number {
  return Math.min(profile.sessionTtlSec, profile.workspaceTtlSec);
}

async function resolveProfileByName(options: {
  agent: Agent;
  profile: string;
  teamId?: string;
}): Promise<DaemonProfile> {
  if (!options.teamId) {
    throw new Error(
      `Daemon profile name "${options.profile}" requires --team. ` +
        'Use a profile UUID when running without a team-scoped list.',
    );
  }

  const profiles = await options.agent.daemonProfiles.list(options.teamId);
  const matches = profiles.items.filter(
    (item) => item.name === options.profile,
  );
  if (matches.length === 0) {
    throw new Error(
      `Daemon profile "${options.profile}" was not found in team ${options.teamId}.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Daemon profile name "${options.profile}" is ambiguous in team ${options.teamId}. ` +
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
