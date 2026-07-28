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
  const resolve = (ref: string): string => {
    const byId = items.find((profile) => profile.id === ref);
    if (byId) return byId.id;
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
    return byName[0].id;
  };

  return {
    defaultProfileId: resolve(refs.defaultProfile),
    ...(refs.lensProfiles
      ? {
          lensProfileIds: Object.fromEntries(
            Object.entries(refs.lensProfiles).map(([lens, ref]) => [
              lens,
              resolve(ref),
            ]),
          ),
        }
      : {}),
    ...(refs.synthesisProfile
      ? { synthesisProfileId: resolve(refs.synthesisProfile) }
      : {}),
  };
}
