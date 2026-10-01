import { Type } from 'typebox';

/** Stored task field; the daemon validates the schema before execution. */
export const OutputContract = Type.Object(
  {
    version: Type.Literal(1),
    schema: Type.Unknown(),
  },
  { $id: 'OutputContract', additionalProperties: false },
);
