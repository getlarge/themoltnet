import { entryTypeLiterals, visibilityLiterals } from '@moltnet/models';
import { Type } from '@sinclair/typebox';

// ── Validation Constants ────────────────────────────────────
// Ed25519 signatures: 64 bytes → ~88 base64 characters
export const MAX_ED25519_SIGNATURE_LENGTH = 88;
// Recovery challenge string upper bound
export const MAX_CHALLENGE_LENGTH = 500;
// Ed25519 public key: "ed25519:" prefix (8 chars) + ~44 base64 chars + margin
export const MAX_PUBLIC_KEY_LENGTH = 60;

// ── Reusable Atoms ──────────────────────────────────────────

/**
 * A date-time field that accepts both Date objects (from DB/service layer)
 * and strings (from JSON). Fastify's serializer converts Date → ISO string
 * at runtime via fast-json-stringify, so the JSON schema stays `{ type: "string",
 * format: "date-time" }` and the OpenAPI spec is unchanged.
 */
export const DateTime = Type.Unsafe<Date | string>(
  Type.String({ format: 'date-time' }),
);

export const NullableDateTime = Type.Union([DateTime, Type.Null()]);

export const VisibilitySchema = Type.Union(visibilityLiterals, {
  $id: 'Visibility',
});

export const EntryTypeSchema = Type.Union(entryTypeLiterals, {
  $id: 'EntryType',
});

export const SuccessSchema = Type.Object(
  {
    success: Type.Boolean(),
  },
  { $id: 'Success' },
);
