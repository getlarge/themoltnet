/** Shared submit argument normalization for Pi Durable. */
import { validateToolArguments } from '@earendil-works/pi-ai';
import { parseCompleteJsonValue } from '@moltnet/json-repair';
import type { SubmitRepair } from '@themoltnet/agent-runtime';
import {
  alignToSchema,
  type getSubmitOutputContract,
  SUBMIT_OUTPUT_GATE_ID,
  type validateAgentTaskSubmission,
} from '@themoltnet/agent-runtime';
import type { TSchema } from 'typebox';

/** Show the submission contract in the Durable prompt. */
export function submitOutputGuidance(
  taskType: string,
  contract: NonNullable<ReturnType<typeof getSubmitOutputContract>>,
) {
  return {
    promptSnippet:
      `${contract.toolName}: submit the final structured ${taskType} ` +
      'output. Use the agent submission schema below exactly; runtime-owned ' +
      'telemetry fields are not yours to supply.\n\n' +
      `Agent submission schema:\n\`\`\`json\n${contract.parametersSchemaJson}\n\`\`\``,
    promptGuidelines: [
      `Call \`${contract.toolName}\` with the exact ${taskType} agent submission shape shown above.`,
      'If the submit tool returns a validation error, fix every listed field and call the same tool again.',
      'The first valid submission is final and immediately ends the session.',
    ],
  };
}

export interface SubmitNormalizationOptions {
  input?: unknown;
  inputCid?: string;
}

export function formatValidationErrors(
  errors: ReturnType<typeof validateAgentTaskSubmission>,
): string {
  return errors.map((err) => `${err.field}: ${err.message}`).join('; ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Only the auto-injected submit-output gate may be verified mechanically.
 */
function onlySubmitOutputGate(input: unknown): boolean {
  if (!isRecord(input) || !isRecord(input.successCriteria)) return false;
  const criteria = input.successCriteria;
  const gates = criteria.gates;
  if (!Array.isArray(gates) || gates.length !== 1) return false;
  const [gate] = gates as unknown[];
  if (!isRecord(gate) || gate.id !== SUBMIT_OUTPUT_GATE_ID) return false;

  const assertions = criteria.assertions;
  if (Array.isArray(assertions) && assertions.length > 0) return false;
  return (
    criteria.rubric === undefined &&
    criteria.sideEffects === undefined &&
    criteria.minComposite === undefined
  );
}

/**
 * Repair a producer submit-output payload when the task's ONLY success gate is
 * the auto-injected submit-output gate — i.e. there is nothing substantive to
 * self-assess, so the `verification` record is a mechanical stamp. Applies to
 * any producer task type (freeform, run_eval, …), not just freeform: weaker
 * models mis-type or omit the nested `verification` object identically across
 * types, and previously only freeform was repaired, so run_eval attempts failed
 * `output_validation_failed` on verification alone. Syntax alignment is
 * handled separately by the shared schema normalizer, and the caller
 * re-validates the stamped payload against the task contract.
 */
function repairProducerSubmitOutput(
  taskType: string,
  params: unknown,
  opts: SubmitNormalizationOptions,
): Record<string, unknown> | null {
  if (
    !isRecord(params) ||
    !opts.inputCid ||
    !onlySubmitOutputGate(opts.input)
  ) {
    return null;
  }

  const repaired: Record<string, unknown> = { ...params };

  repaired.verification = {
    inputCid: opts.inputCid,
    results: [
      {
        id: SUBMIT_OUTPUT_GATE_ID,
        kind: 'gate',
        status: 'pass',
        detail: `submit_${taskType}_output accepted valid args`,
      },
    ],
    passed: true,
  };

  return repaired;
}

export function normalizeSubmitArguments(
  taskType: string,
  params: unknown,
  schema: TSchema,
  toolName: string,
  description: string,
  opts: SubmitNormalizationOptions,
): { candidate: unknown; repairs: SubmitRepair[] } {
  const aligned = alignToSchema(params, schema, {
    parseJsonString: parseCompleteJsonValue,
  });
  const repairs: SubmitRepair[] = [...aligned.repairs];
  // Producer repair is mechanical for a submit-only gate. Apply it before
  // Pi validation, which removes strict-mode null placeholders. Cross-field
  // task validation runs on Pi's cleaned value in execute().
  const repaired = repairProducerSubmitOutput(taskType, aligned.value, opts);
  const candidate = repaired ?? aligned.value;
  if (repaired && isRecord(aligned.value)) {
    if (
      JSON.stringify(repaired.verification) !==
      JSON.stringify(aligned.value.verification)
    )
      repairs.push({ kind: 'submit_gate_verification', path: '/verification' });
  }
  const piNormalized = validateToolArguments(
    { name: toolName, description, parameters: schema },
    {
      type: 'toolCall',
      id: 'submit-prepare',
      name: toolName,
      arguments: candidate as Record<string, never>,
    },
  ) as Record<string, unknown>;
  if (JSON.stringify(piNormalized) !== JSON.stringify(candidate)) {
    repairs.push({ kind: 'pi_schema_coercion', path: '' });
  }
  return { candidate: piNormalized, repairs };
}
