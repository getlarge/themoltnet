/**
 * Whether a runtime profile can execute on *this* machine.
 *
 * A profile is authored in Console against a team; whether it can run depends
 * on local facts only the server knows — which provider keys are configured
 * here and which runtime kinds this machine can produce.
 *
 * The prerequisite comparison itself is **not** reimplemented here. Run start
 * calls `validateRuntimeProfilePrerequisites`, and the catalogue calls the same
 * function, so the composer cannot promise a run that startup would reject for
 * a reason the two evaluated differently.
 */
import {
  RuntimeProfilePrerequisiteError,
  validateRuntimeProfilePrerequisites,
} from '@themoltnet/agent-runtime';

export type ProfileBlockerCode =
  | 'env_missing'
  | 'tool_missing'
  | 'executable_missing'
  | 'runtime_unregistered';

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
  requiredEnv: string[];
  requiredTools: string[];
  requiredExecutables: string[];
}

export interface MachineCapabilities {
  /** Provider `envName` -> whether an API key is configured for it here. */
  providerEnv: ReadonlyMap<string, boolean>;
  /** Runtime kinds this machine can execute, resolved with integrity checks. */
  runtimeKinds: ReadonlySet<string>;
  /**
   * What the runtime adapter provides, when it is known.
   *
   * Readiness runs without preparing a runtime, so usually it is not. Omitting
   * it means tools and executables are left unevaluated rather than reported
   * missing: a guess that blocks a runnable profile is worse than saying
   * nothing, and run start checks them for real.
   */
  inventory?: { tools?: readonly string[]; executables?: readonly string[] };
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

  // The shared evaluator tests `!env[name]`, so presence is all it needs; a
  // configured provider with no key must not read as present.
  const env: NodeJS.ProcessEnv = {};
  for (const [name, configured] of machine.providerEnv) {
    if (configured) env[name] = 'configured';
  }

  try {
    validateRuntimeProfilePrerequisites(profile, env, {
      // With no inventory, treat the profile's own requirements as satisfied:
      // the adapter has not been asked yet, so nothing is known to be absent.
      tools: machine.inventory?.tools ?? profile.requiredTools,
      executables:
        machine.inventory?.executables ?? profile.requiredExecutables,
    });
  } catch (error) {
    if (!(error instanceof RuntimeProfilePrerequisiteError)) throw error;
    for (const name of error.missingEnv) {
      blockers.push({
        code: 'env_missing',
        message: `${name} is not configured on this machine.`,
        remedy: 'Add the key under Providers, then reopen this run.',
      });
    }
    for (const name of error.missingTools) {
      blockers.push({
        code: 'tool_missing',
        message: `The runtime does not provide the tool ${name}.`,
        remedy: `Use a profile whose runtime provides ${name}, or change the profile in Console.`,
      });
    }
    for (const name of error.missingExecutables) {
      blockers.push({
        code: 'executable_missing',
        message: `The runtime does not provide the executable ${name}.`,
        remedy: `Use a runtime that ships ${name}, or drop the requirement in Console.`,
      });
    }
  }

  if (!machine.runtimeKinds.has(profile.runtimeKind)) {
    blockers.push({
      code: 'runtime_unregistered',
      message: `Runtime kind ${profile.runtimeKind} is not available on this machine.`,
      remedy: 'Register the runtime under Runtimes, then reopen this run.',
    });
  }

  return { ready: blockers.length === 0, blockers };
}
