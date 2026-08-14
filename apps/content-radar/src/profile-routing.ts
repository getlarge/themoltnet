import type { Agent } from '@themoltnet/sdk';

import type { ContentRadarProfileRouting } from './types.js';

type RuntimeProfilesSource = Pick<Agent, 'runtimeProfiles'>;

/**
 * Resolve team-scoped profile names to immutable profile ids once, before the
 * durable workflow spawns. Tasks then pin the resolved id through
 * `allowedProfiles`, so a profile renamed mid-run cannot silently reroute a
 * phase to a different runtime.
 */
export async function resolveProfileRouting(
  agent: RuntimeProfilesSource,
  teamId: string,
  refs: ContentRadarProfileRouting,
): Promise<ContentRadarProfileRouting> {
  const { items } = await agent.runtimeProfiles.list({ teamId });
  const cache = new Map<string, string>();
  const resolve = (ref: string): string => {
    const cached = cache.get(ref);
    if (cached) return cached;
    const byId = items.find((profile) => profile.id === ref);
    if (byId) {
      cache.set(ref, byId.id);
      return byId.id;
    }
    const byName = items.filter((profile) => profile.name === ref);
    if (byName.length === 0) {
      throw new Error(
        `runtime profile "${ref}" was not found in team ${teamId}`,
      );
    }
    if (byName.length > 1) {
      throw new Error(
        `runtime profile name "${ref}" is ambiguous in team ${teamId}`,
      );
    }
    cache.set(ref, byName[0].id);
    return byName[0].id;
  };
  return {
    defaultProfileId: resolve(refs.defaultProfileId),
    ...(refs.scanProfileId
      ? { scanProfileId: resolve(refs.scanProfileId) }
      : {}),
    ...(refs.sweepProfileId
      ? { sweepProfileId: resolve(refs.sweepProfileId) }
      : {}),
    ...(refs.correlateProfileId
      ? { correlateProfileId: resolve(refs.correlateProfileId) }
      : {}),
    ...(refs.draftProfileId
      ? { draftProfileId: resolve(refs.draftProfileId) }
      : {}),
  };
}
