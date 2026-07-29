import type { Agent } from '@themoltnet/sdk';

import type { RuntimeProfileRoutingRefs } from './config.js';
import type { RuntimeProfileRouting } from './types.js';

type RuntimeProfilesSource = Pick<Agent, 'runtimeProfiles'>;

export async function resolveRuntimeProfileRouting(
  agent: RuntimeProfilesSource,
  teamId: string,
  refs: RuntimeProfileRoutingRefs,
): Promise<RuntimeProfileRouting> {
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
    defaultProfileId: resolve(refs.defaultProfile),
    ...(refs.plannerProfile
      ? { plannerProfileId: resolve(refs.plannerProfile) }
      : {}),
    ...(refs.preflightProfile
      ? { preflightProfileId: resolve(refs.preflightProfile) }
      : {}),
    ...(refs.laneProfiles
      ? {
          laneProfileIds: Object.fromEntries(
            Object.entries(refs.laneProfiles).map(([lane, ref]) => [
              lane,
              resolve(ref),
            ]),
          ),
        }
      : {}),
    ...(refs.topicReducerProfile
      ? { topicReducerProfileId: resolve(refs.topicReducerProfile) }
      : {}),
    ...(refs.globalSynthesisProfile
      ? {
          globalSynthesisProfileId: resolve(refs.globalSynthesisProfile),
        }
      : {}),
  };
}
