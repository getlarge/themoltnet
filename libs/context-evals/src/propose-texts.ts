/**
 * propose-texts.ts — Shared propose_new_texts implementation for GEPA adapters.
 *
 * Mirrors Python GEPA's InstructionProposalSignature: a reflection LM reads
 * the adapter's reflective dataset and proposes improved instructions.
 * Both MoltNetContextAdapter and SkillEvalAdapter delegate here.
 */

import type { AxAIService } from '@ax-llm/ax';
import { ax } from '@ax-llm/ax';

// ── Reflection prompt ────────────────────────────────────────────────────────

/**
 * Matches upstream GEPA's InstructionProposalSignature prompt template.
 * See: gepa-ai/gepa/src/gepa/strategies/instruction_proposal.py
 */
const REFLECTION_INSTRUCTION = `I provided an assistant with the following \
instructions to perform a task for me.

Read the inputs carefully and identify the input format and infer detailed \
task description about the task I wish to solve with the assistant.

Read all the assistant responses and the corresponding feedback. Identify all \
niche and domain specific factual information about the task and include it in \
the instruction, as a lot of it may not be available to the assistant in the \
future. The assistant may have utilized a generalizable strategy to solve the \
task, if so, include that in the instruction as well.`;

// ── Public API ───────────────────────────────────────────────────────────────

export interface ProposeNewTextsOptions {
  reflectionAI?: AxAIService;
  candidate: Readonly<Record<string, string>>;
  reflectiveDataset: Readonly<Record<string, unknown[]>>;
  componentsToUpdate: readonly string[];
}

/**
 * Propose new instruction texts using a reflection LM and the adapter's
 * reflective dataset. Returns a map of component ID → new instruction text.
 *
 * When no reflectionAI is provided, returns an empty map — ax-llm falls
 * back to its built-in reflectTargetInstruction (which uses dummy student
 * predictions, but at least doesn't crash).
 */
export async function proposeNewTexts(
  options: ProposeNewTextsOptions,
): Promise<Record<string, string>> {
  const { reflectionAI, candidate, reflectiveDataset, componentsToUpdate } =
    options;
  if (!reflectionAI) return {};

  const result: Record<string, string> = {};

  for (const component of componentsToUpdate) {
    const entries = reflectiveDataset[component];
    if (!entries?.length) continue;

    const currentInstruction = candidate[component] ?? '';
    const formattedFeedback = formatReflectiveDataset(entries);

    const program = ax(
      'currentInstruction:string, feedback:string -> newInstruction:string "Improved instruction incorporating feedback"',
    );
    program.setInstruction(REFLECTION_INSTRUCTION);

    try {
      const out = (await program.forward(reflectionAI, {
        currentInstruction,
        feedback: formattedFeedback,
      })) as { newInstruction?: string };

      const instruction = out?.newInstruction?.trim();
      if (instruction && instruction.length > 16) {
        result[component] = instruction;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[propose-texts] reflection failed for ${component}:`, err);
    }
  }

  return result;
}

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * Format reflective dataset entries as markdown — matching GEPA's
 * InstructionProposalSignature.format_samples() output.
 */
function formatReflectiveDataset(entries: unknown[]): string {
  return entries
    .map((entry, i) => {
      const record = entry as Record<string, unknown>;
      const parts = [`# Example ${i + 1}`];
      for (const [key, value] of Object.entries(record)) {
        parts.push(`## ${key}`);
        parts.push(
          typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        );
      }
      return parts.join('\n');
    })
    .join('\n\n');
}
