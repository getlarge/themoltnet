/**
 * Load a committed runtime profile and the policies bound to it, so an eval
 * can run a producer under the same definition production uses.
 *
 * Sources (all relative to the repository root):
 *   - `.github/runtime-profiles/<name>.json`   — profile create body
 *   - `.github/runtime-policies/<name>.json`   — policy create body
 *   - `.github/runtime-policy-bindings.json`   — profile name → policy names
 *
 * The loader only reads and rewrites create bodies. It never talks to an API,
 * and the committed files carry no diary, team or task identifiers, so the
 * result cannot point at production data on its own. Whatever server the
 * caller creates the bodies on decides what they can reach.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type CreateRuntimePolicyBody,
  CreateRuntimePolicyBodySchema,
  type CreateRuntimeProfileBody,
  CreateRuntimeProfileBodySchema,
  RuntimeDefinitionReferences,
  type RuntimeProfileGeneration,
  type RuntimeProfileModelSelection,
  type RuntimeProfileSandbox,
} from '@moltnet/runtime-profiles';
import { Type } from 'typebox';
import { Value } from 'typebox/value';

export const RUNTIME_PROFILES_DIR = '.github/runtime-profiles';
export const RUNTIME_POLICIES_DIR = '.github/runtime-policies';
export const RUNTIME_POLICY_BINDINGS_FILE =
  '.github/runtime-policy-bindings.json';

/**
 * Host-side configuration of the optional adaptive-review diary runtime. It
 * selects which diaries the review tools may read, so it must come from the
 * trusted host process, never from a profile's guest environment.
 */
const HOST_ONLY_ENV = new Set(['ADAPTIVE_REVIEW_DIARY_IDS']);

export class CommittedProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommittedProfileError';
  }
}

export interface CommittedRuntimeDefinitions {
  profile: CreateRuntimeProfileBody;
  /** Policies bound to the profile, in binding order. */
  policies: CreateRuntimePolicyBody[];
}

/**
 * What an e2e environment may change. Everything else — context, tool
 * enforcement, VFS shadowing, network rules, turn and timeout budgets,
 * workspace modes, required tools — is the behaviour under test and stays as
 * committed.
 */
export interface EvalProfileOverrides {
  /**
   * Appended as `-<suffix>` to the profile and every policy name so the eval
   * does not collide with live definitions or concurrent runs.
   */
  nameSuffix: string;
  /** Replace the generation model; unset sampling fields keep committed values. */
  generation?: RuntimeProfileModelSelection &
    Partial<Omit<RuntimeProfileGeneration, 'provider' | 'model'>>;
  /** Replace the classification model. */
  classification?: RuntimeProfileModelSelection;
  /** Replace `requiredEnv` (provider keys differ between e2e and production). */
  requiredEnv?: string[];
  /** Merged into `sandbox.env`. */
  sandboxEnv?: Record<string, string>;
  /** Replace `sandbox.resources`. */
  sandboxResources?: RuntimeProfileSandbox['resources'];
}

const RuntimePolicyBindings = Type.Record(
  Type.String({ pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$' }),
  Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }),
);
export type RuntimePolicyBindings = Record<string, string[]>;

function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new CommittedProfileError(
      `Cannot read ${path}: ${(error as Error).message}`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new CommittedProfileError(
      `Invalid JSON in ${path}: ${(error as Error).message}`,
    );
  }
}

function describeErrors(
  schema: Parameters<typeof Value.Errors>[1],
  value: unknown,
): string {
  return [...Value.Errors(RuntimeDefinitionReferences, schema, value)]
    .map((e) => `${e.instancePath || '/'}: ${e.message}`)
    .join('; ');
}

export function assertRuntimeProfileBody(
  value: unknown,
  source: string,
): asserts value is CreateRuntimeProfileBody {
  if (
    !Value.Check(
      RuntimeDefinitionReferences,
      CreateRuntimeProfileBodySchema,
      value,
    )
  ) {
    throw new CommittedProfileError(
      `${source} is not a valid runtime profile create body: ${describeErrors(CreateRuntimeProfileBodySchema, value)}`,
    );
  }
}

export function assertRuntimePolicyBody(
  value: unknown,
  source: string,
): asserts value is CreateRuntimePolicyBody {
  if (
    !Value.Check(
      RuntimeDefinitionReferences,
      CreateRuntimePolicyBodySchema,
      value,
    )
  ) {
    throw new CommittedProfileError(
      `${source} is not a valid runtime policy create body: ${describeErrors(CreateRuntimePolicyBodySchema, value)}`,
    );
  }
}

/** Read a committed definition file and check its `name` matches the file. */
function readNamed<T extends { name: string }>(
  repoRoot: string,
  dir: string,
  name: string,
  assert: (value: unknown, source: string) => asserts value is T,
): T {
  const source = `${dir}/${name}.json`;
  const value = readJson(join(repoRoot, source));
  assert(value, source);
  if (value.name !== name) {
    throw new CommittedProfileError(
      `${source} declares name "${value.name}"; the file name and name must match`,
    );
  }
  return value;
}

export function readRuntimePolicyBindings(
  repoRoot: string,
): RuntimePolicyBindings {
  const value = readJson(join(repoRoot, RUNTIME_POLICY_BINDINGS_FILE));
  if (!Value.Check(RuntimePolicyBindings, value)) {
    throw new CommittedProfileError(
      `${RUNTIME_POLICY_BINDINGS_FILE} must map profile names to non-empty, unique policy-name lists: ${[
        ...Value.Errors(RuntimePolicyBindings, value),
      ]
        .map((e) => `${e.instancePath || '/'}: ${e.message}`)
        .join('; ')}`,
    );
  }
  return value;
}

/** Read a committed profile and its bound policies exactly as committed. */
export function readCommittedRuntimeProfile(
  repoRoot: string,
  profileName: string,
): CommittedRuntimeDefinitions {
  const profile = readNamed(
    repoRoot,
    RUNTIME_PROFILES_DIR,
    profileName,
    assertRuntimeProfileBody,
  );
  const policyNames = readRuntimePolicyBindings(repoRoot)[profileName] ?? [];
  if (profile.toolEnforcement === 'enforce' && policyNames.length === 0) {
    // An enforcing profile with nothing bound allows no tools at all.
    throw new CommittedProfileError(
      `${profileName} enforces tool policy but has no entry in ${RUNTIME_POLICY_BINDINGS_FILE}`,
    );
  }
  const policies = policyNames.map((name) =>
    readNamed(repoRoot, RUNTIME_POLICIES_DIR, name, assertRuntimePolicyBody),
  );
  return { profile, policies };
}

/** Apply the e2e override set and re-validate the result. */
export function applyEvalProfileOverrides(
  definitions: CommittedRuntimeDefinitions,
  overrides: EvalProfileOverrides,
): CommittedRuntimeDefinitions {
  const { profile } = definitions;
  if (!/^[a-zA-Z0-9_-]+$/.test(overrides.nameSuffix)) {
    throw new CommittedProfileError(
      `nameSuffix "${overrides.nameSuffix}" may contain only letters, digits, "_" and "-"`,
    );
  }
  for (const name of Object.keys(overrides.sandboxEnv ?? {})) {
    if (HOST_ONLY_ENV.has(name)) {
      throw new CommittedProfileError(
        `${name} is host configuration and must not be set in the guest sandbox environment`,
      );
    }
  }
  if (overrides.generation && !profile.models.generation) {
    throw new CommittedProfileError(
      `${profile.name} has no generation model to override`,
    );
  }
  if (overrides.classification && !profile.models.classification) {
    throw new CommittedProfileError(
      `${profile.name} has no classification model to override`,
    );
  }

  const suffixed = (name: string) => `${name}-${overrides.nameSuffix}`;
  const models = {
    ...profile.models,
    ...(overrides.generation && profile.models.generation
      ? {
          generation: {
            ...profile.models.generation,
            ...overrides.generation,
          },
        }
      : {}),
    ...(overrides.classification
      ? { classification: overrides.classification }
      : {}),
  };
  const sandbox: RuntimeProfileSandbox = {
    ...profile.sandbox,
    ...(overrides.sandboxEnv
      ? { env: { ...profile.sandbox.env, ...overrides.sandboxEnv } }
      : {}),
    ...(overrides.sandboxResources
      ? { resources: overrides.sandboxResources }
      : {}),
  };
  const result: CommittedRuntimeDefinitions = {
    profile: {
      ...profile,
      name: suffixed(profile.name),
      models,
      sandbox,
      ...(overrides.requiredEnv ? { requiredEnv: overrides.requiredEnv } : {}),
    },
    policies: definitions.policies.map((policy) => ({
      ...policy,
      name: suffixed(policy.name),
    })),
  };
  assertRuntimeProfileBody(result.profile, `${profile.name} with overrides`);
  for (const policy of result.policies) {
    assertRuntimePolicyBody(policy, `${policy.name} with overrides`);
  }
  return result;
}

/** Read a committed profile + bound policies and apply the e2e override set. */
export function loadCommittedRuntimeProfile(
  repoRoot: string,
  profileName: string,
  overrides: EvalProfileOverrides,
): CommittedRuntimeDefinitions {
  return applyEvalProfileOverrides(
    readCommittedRuntimeProfile(repoRoot, profileName),
    overrides,
  );
}
