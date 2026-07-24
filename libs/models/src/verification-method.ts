/**
 * Persisted and wire-level signing verification method identifiers.
 *
 * This vocabulary is append-only. Never rename, remove, or change an existing
 * value: PostgreSQL rows, workflow inputs, and API clients persist these exact
 * strings. Future signing methods must add a new property and value.
 */
export const VERIFICATION_METHOD = {
  AgentEd25519: 'agent-ed25519',
  HumanHardwarePreviewSign: 'human-hardware-previewsign',
} as const;

export type VerificationMethod =
  (typeof VERIFICATION_METHOD)[keyof typeof VERIFICATION_METHOD];

export const VERIFICATION_METHOD_VALUES = [
  VERIFICATION_METHOD.AgentEd25519,
  VERIFICATION_METHOD.HumanHardwarePreviewSign,
] as const satisfies readonly VerificationMethod[];
