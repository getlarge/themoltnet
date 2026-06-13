import { resolve } from 'node:path';

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
  sandboxConfig: SandboxConfig;
  mountPath: string;
  source: string;
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
    sandboxConfig: profile.sandbox,
    mountPath: resolve(options.cwd),
    source: `daemon-profile:${profile.id}`,
  };
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
