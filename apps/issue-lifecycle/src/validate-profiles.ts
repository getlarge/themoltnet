import {
  type LifecycleConfig,
  LifecycleStepNames,
} from './lifecycle-config.js';

/**
 * Minimal structural view of the SDK's runtime-profiles namespace — just the
 * `get` we need. Depending on the shape (not the concrete Agent type) keeps
 * this validator unit-testable with a tiny fake.
 */
export interface RuntimeProfileResolver {
  get(profileId: string): Promise<unknown>;
}

/** Collect the distinct profileIds referenced by a lifecycle config. */
export function configuredProfileIds(config: LifecycleConfig): string[] {
  const ids = new Set<string>();
  for (const step of LifecycleStepNames) {
    const profileId = config[step]?.profileId;
    if (profileId) ids.add(profileId);
  }
  return [...ids];
}

/**
 * Verify every profileId referenced by the lifecycle config resolves to a real
 * runtime profile the agent can read. A well-formed but nonexistent (or
 * inaccessible) profile UUID would otherwise produce tasks with an
 * `allowedProfiles` allowlist that no daemon can ever satisfy — the task would
 * silently hang. Fail fast at startup instead, with an actionable error.
 *
 * No-op when the config references no profiles.
 */
export async function validateConfiguredProfiles(
  resolver: RuntimeProfileResolver,
  config: LifecycleConfig,
): Promise<void> {
  const ids = configuredProfileIds(config);
  if (ids.length === 0) return;

  const failures: string[] = [];
  await Promise.all(
    ids.map(async (profileId) => {
      try {
        await resolver.get(profileId);
      } catch (err) {
        failures.push(`${profileId} (${(err as Error).message})`);
      }
    }),
  );

  if (failures.length > 0) {
    throw new Error(
      `Profiles config references runtime profiles that could not be resolved ` +
        `for this agent/team:\n${failures.map((f) => `  - ${f}`).join('\n')}\n` +
        `Check the profileId UUIDs against your team's runtime profiles ` +
        `(a task pinned to an unknown profile can never be claimed).`,
    );
  }
}
