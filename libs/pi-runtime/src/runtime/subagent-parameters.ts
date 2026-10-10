import { type Static, Type } from 'typebox';

/**
 * Parameters shape the parent LLM sees when calling the subagent tool.
 *
 *   - `task`         — natural-language instructions for the subagent.
 *                      The parent authors this per call. Must be
 *                      non-empty.
 *   - `output_schema` — name of a registered SubagentOutputContract.
 *                      Resolved at call time; unknown names error.
 */
export const SubagentToolParameters = Type.Object(
  {
    task: Type.String({
      minLength: 1,
      description:
        'Natural-language instructions for the subagent. The subagent ' +
        'starts with a fresh conversation and a narrowed system prompt; ' +
        'this is the only context it has from you.',
    }),
    output_schema: Type.String({
      minLength: 1,
      description:
        'Name of a registered subagent output contract. The subagent ' +
        'must submit a structured payload via `submit_subagent_output` ' +
        'matching this contract.',
    }),
  },
  { additionalProperties: false },
);
export type SubagentToolParameters = Static<typeof SubagentToolParameters>;
