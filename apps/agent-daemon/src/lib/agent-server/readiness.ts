/**
 * Whether a runtime profile can actually execute on *this* machine.
 *
 * A profile is authored in Console against a team; whether it can run depends
 * on local facts the server owns — which provider keys are configured here and
 * which runtime kinds are registered here. Deriving that server-side keeps the
 * desktop from guessing, and keeps the answer in one place for the composer,
 * the run-start error path, and the catalogue.
 */

export type ProfileBlockerCode = 'env_missing' | 'runtime_unregistered';

export interface ProfileBlocker {
  code: ProfileBlockerCode;
  /** What is wrong, in the operator's terms. */
  message: string;
  /** What to do about it. */
  remedy: string;
}

export interface ProfileRequirements {
  name: string;
  runtimeKind: string;
  requiredEnv: readonly string[];
  requiredExecutables: readonly string[];
}

export interface MachineCapabilities {
  /** Provider `envName` -> whether an API key is configured for it here. */
  providerEnv: ReadonlyMap<string, boolean>;
  /** Runtime kinds this machine can execute: built-in plus registered. */
  runtimeKinds: ReadonlySet<string>;
}

export interface ProfileReadiness {
  ready: boolean;
  blockers: ProfileBlocker[];
}

export function deriveProfileReadiness(
  profile: ProfileRequirements,
  machine: MachineCapabilities,
): ProfileReadiness {
  const blockers: ProfileBlocker[] = [];

  for (const envName of profile.requiredEnv) {
    // A provider row with no key is the common half-done case; it is not ready.
    if (machine.providerEnv.get(envName) === true) continue;
    blockers.push({
      code: 'env_missing',
      message: `${envName} is not configured on this machine.`,
      remedy: `Add the key under Providers in Console, then reopen this run.`,
    });
  }

  if (!machine.runtimeKinds.has(profile.runtimeKind)) {
    blockers.push({
      code: 'runtime_unregistered',
      message: `Runtime kind ${profile.runtimeKind} is not registered on this machine.`,
      remedy: 'Register the runtime under Runtimes, then reopen this run.',
    });
  }

  return { ready: blockers.length === 0, blockers };
}
