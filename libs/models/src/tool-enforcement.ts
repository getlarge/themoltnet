import { type Static, Type } from 'typebox';

export const TOOL_ENFORCEMENT_VALUES = ['off', 'watch', 'enforce'] as const;

const toolEnforcementLiterals = [
  Type.Literal(TOOL_ENFORCEMENT_VALUES[0]),
  Type.Literal(TOOL_ENFORCEMENT_VALUES[1]),
  Type.Literal(TOOL_ENFORCEMENT_VALUES[2]),
] satisfies [
  ReturnType<typeof Type.Literal<'off'>>,
  ReturnType<typeof Type.Literal<'watch'>>,
  ReturnType<typeof Type.Literal<'enforce'>>,
];

export const ToolEnforcementSchema = Type.Union(toolEnforcementLiterals, {
  description:
    'Runtime tool-policy enforcement mode: off (inert), watch (audit only), enforce (block disallowed tools, fail-closed).',
});

export type ToolEnforcement = Static<typeof ToolEnforcementSchema>;
