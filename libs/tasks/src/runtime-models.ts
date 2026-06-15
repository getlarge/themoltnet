import { type Static, Type } from 'typebox';

/**
 * Runtime model catalog: a list of supported provider/model couples that
 * MoltNet daemons can target. Backed by the `runtime_models` table.
 *
 * Scope is intrinsic to the row:
 *   - `teamId == null`  => global entry (MoltNet-seeded, read-only to most callers)
 *   - `teamId != null`  => team-owned custom entry
 *
 * The REST API exposes a single shape regardless of scope; the team header
 * gates which rows are returned.
 */

export const RuntimeModelProvider = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: '^[a-z][a-z0-9._-]{0,99}$',
});
export type RuntimeModelProvider = Static<typeof RuntimeModelProvider>;

export const RuntimeModelName = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: '^[a-zA-Z0-9][a-z0-9._:-]{0,199}$',
});
export type RuntimeModelName = Static<typeof RuntimeModelName>;

export const RuntimeModelCapabilities = Type.Record(
  Type.String({ minLength: 1, maxLength: 64 }),
  Type.Union([Type.Boolean(), Type.Number(), Type.String({ maxLength: 256 })]),
  { additionalProperties: false },
);
export type RuntimeModelCapabilities = Static<typeof RuntimeModelCapabilities>;

export const RuntimeModel = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    teamId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    provider: RuntimeModelProvider,
    model: RuntimeModelName,
    displayName: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    description: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
    capabilities: RuntimeModelCapabilities,
    isActive: Type.Boolean(),
    createdByAgentId: Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Null(),
    ]),
    createdByHumanId: Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Null(),
    ]),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'RuntimeModel', additionalProperties: false },
);
export type RuntimeModel = Static<typeof RuntimeModel>;
