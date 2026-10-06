/**
 * Vocabulary for repairs applied to a model's submit payload. Executors emit
 * these kinds in `output_completion` telemetry and evals score them, so both
 * sides type against this one list.
 */

/** Complete-JSON syntax repairs for a string value parsed as JSON. */
export const JSON_SYNTAX_REPAIR_KINDS = [
  'lenient_json',
  'missing_comma',
] as const;
export type JsonSyntaxRepairKind = (typeof JSON_SYNTAX_REPAIR_KINDS)[number];

/** Repairs schema alignment makes to fit a value to the advertised schema. */
export const SCHEMA_ALIGNMENT_REPAIR_KINDS = [
  'output_envelope',
  'json_string',
  'single_to_array',
  'case_insensitive_match',
  'optional_null',
  ...JSON_SYNTAX_REPAIR_KINDS,
] as const;
export type SchemaAlignmentRepairKind =
  (typeof SCHEMA_ALIGNMENT_REPAIR_KINDS)[number];

/** Every repair an executor may report for an accepted or rejected submit. */
export const SUBMIT_REPAIR_KINDS = [
  ...SCHEMA_ALIGNMENT_REPAIR_KINDS,
  // The runtime stamped `verification` for a submit-only gate.
  'submit_gate_verification',
  // The executor's tool-schema validator coerced the value.
  'pi_schema_coercion',
] as const;
export type SubmitRepairKind = (typeof SUBMIT_REPAIR_KINDS)[number];

/**
 * Repairs made by the submit protocol rather than the model: removing a
 * strict-mode null placeholder and stamping runtime-owned verification. They
 * do not count against a model's submit shape.
 */
export const SUBMIT_PROTOCOL_REPAIR_KINDS = [
  'optional_null',
  'submit_gate_verification',
] as const satisfies readonly SubmitRepairKind[];

export interface SubmitRepair {
  kind: SubmitRepairKind;
  /** JSON pointer to the value changed; the root is the empty string. */
  path: string;
}
