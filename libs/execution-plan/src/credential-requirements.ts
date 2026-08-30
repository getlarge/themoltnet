import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';

export const CREDENTIAL_KINDS = [
  'http-bearer',
  'http-basic',
  'api-key-header',
] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export const CREDENTIAL_PROJECTIONS = ['host-tool', 'brokered-http'] as const;
export type CredentialProjection = (typeof CREDENTIAL_PROJECTIONS)[number];

export const CredentialDestination = Type.Object(
  {
    protocol: Type.Union([Type.Literal('https'), Type.Literal('http')]),
    /** Exact canonical hostname: lowercase, no wildcard, no trailing dot. */
    host: Type.String({
      minLength: 1,
      maxLength: 255,
      pattern:
        '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$',
    }),
    port: Type.Integer({ minimum: 1, maximum: 65535 }),
  },
  { additionalProperties: false },
);
export type CredentialDestination = Static<typeof CredentialDestination>;

export const GuestEnvName = Type.String({
  minLength: 1,
  maxLength: 128,
  /** Uppercase env identifier; MOLTNET_* is reserved for the runtime. */
  pattern: '^(?!MOLTNET_)[A-Z][A-Z0-9_]*$',
});

export const CredentialLifecycleIntent = Type.Object(
  {
    maxTtlSec: Type.Integer({ minimum: 1, maximum: 86400 }),
    refreshBeforeSec: Type.Integer({ minimum: 1, maximum: 86400 }),
  },
  { additionalProperties: false },
);
export type CredentialLifecycleIntent = Static<
  typeof CredentialLifecycleIntent
>;

const credentialRequirementBase = {
  name: Type.String({ minLength: 1 }),
  kind: Type.Union([
    Type.Literal('http-bearer'),
    Type.Literal('http-basic'),
    Type.Literal('api-key-header'),
  ]),
  destinations: Type.Array(CredentialDestination, { minItems: 1 }),
  required: Type.Boolean({ default: true }),
  lifecycle: Type.Optional(CredentialLifecycleIntent),
};

export const HostToolCredentialRequirement = Type.Object(
  {
    ...credentialRequirementBase,
    projection: Type.Literal('host-tool'),
  },
  { additionalProperties: false },
);
export type HostToolCredentialRequirement = Static<
  typeof HostToolCredentialRequirement
>;

export const BrokeredHttpCredentialRequirement = Type.Object(
  {
    ...credentialRequirementBase,
    projection: Type.Literal('brokered-http'),
    guestEnv: GuestEnvName,
  },
  { additionalProperties: false },
);
export type BrokeredHttpCredentialRequirement = Static<
  typeof BrokeredHttpCredentialRequirement
>;

export const CredentialRequirement = Type.Union([
  HostToolCredentialRequirement,
  BrokeredHttpCredentialRequirement,
]);
export type CredentialRequirement = Static<typeof CredentialRequirement>;

export function parseCredentialRequirements(
  input: unknown,
): CredentialRequirement[] {
  const withDefaults = Value.Default(
    Type.Array(CredentialRequirement),
    Value.Clone(input),
  );
  const requirements = Value.Parse(
    Type.Array(CredentialRequirement),
    withDefaults,
  );
  const names = new Set<string>();
  const guestEnvs = new Set<string>();
  for (const requirement of requirements) {
    if (names.has(requirement.name)) {
      throw new Error(
        `duplicate credential requirement name "${requirement.name}"`,
      );
    }
    names.add(requirement.name);
    if (requirement.projection === 'brokered-http') {
      if (guestEnvs.has(requirement.guestEnv)) {
        throw new Error(
          `duplicate brokered guestEnv "${requirement.guestEnv}"`,
        );
      }
      guestEnvs.add(requirement.guestEnv);
    }
    const lifecycle = requirement.lifecycle;
    if (lifecycle && lifecycle.refreshBeforeSec >= lifecycle.maxTtlSec) {
      throw new Error(
        `credential requirement "${requirement.name}": refreshBeforeSec must be shorter than maxTtlSec`,
      );
    }
  }
  return requirements;
}
