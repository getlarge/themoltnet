import { describe, it, expect, beforeAll } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { FormatRegistry } from '@sinclair/typebox';
import {
  CreateDiaryEntrySchema,
  UpdateDiaryEntrySchema,
  DiarySearchSchema,
  ShareEntrySchema,
  SetVisibilitySchema,
  SignRequestSchema,
  VerifyRequestSchema,
  AuthContextSchema,
  PublicKeySchema,
  FingerprintSchema,
  MoltbookNameSchema,
  VisibilitySchema,
  PaginatedResponseSchema,
  DiaryEntrySchema,
  ErrorResponseSchema,
} from '../src/index.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

beforeAll(() => {
  if (!FormatRegistry.Has('uuid')) {
    FormatRegistry.Set('uuid', (v) => UUID_RE.test(v));
  }
  if (!FormatRegistry.Has('date-time')) {
    FormatRegistry.Set('date-time', (v) => DATE_TIME_RE.test(v));
  }
});

describe('Common schemas', () => {
  describe('PublicKeySchema', () => {
    it('accepts valid ed25519 keys', () => {
      expect(Value.Check(PublicKeySchema, 'ed25519:AAAA+/bbbb==')).toBe(true);
    });

    it('rejects keys without prefix', () => {
      expect(Value.Check(PublicKeySchema, 'AAAA+/bbbb==')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(Value.Check(PublicKeySchema, '')).toBe(false);
    });
  });

  describe('FingerprintSchema', () => {
    it('accepts valid fingerprint', () => {
      expect(Value.Check(FingerprintSchema, 'A1B2-C3D4-E5F6-07A8')).toBe(true);
    });

    it('rejects lowercase', () => {
      expect(Value.Check(FingerprintSchema, 'a1b2-c3d4-e5f6-07a8')).toBe(false);
    });

    it('rejects wrong length', () => {
      expect(Value.Check(FingerprintSchema, 'A1B2-C3D4')).toBe(false);
    });
  });

  describe('MoltbookNameSchema', () => {
    it('accepts valid names', () => {
      expect(Value.Check(MoltbookNameSchema, 'Claude')).toBe(true);
    });

    it('rejects empty string', () => {
      expect(Value.Check(MoltbookNameSchema, '')).toBe(false);
    });

    it('rejects names over 100 chars', () => {
      expect(Value.Check(MoltbookNameSchema, 'a'.repeat(101))).toBe(false);
    });
  });

  describe('VisibilitySchema', () => {
    it('accepts valid values', () => {
      expect(Value.Check(VisibilitySchema, 'private')).toBe(true);
      expect(Value.Check(VisibilitySchema, 'moltnet')).toBe(true);
      expect(Value.Check(VisibilitySchema, 'public')).toBe(true);
    });

    it('rejects invalid values', () => {
      expect(Value.Check(VisibilitySchema, 'secret')).toBe(false);
      expect(Value.Check(VisibilitySchema, '')).toBe(false);
    });
  });
});

describe('Diary schemas', () => {
  describe('CreateDiaryEntrySchema', () => {
    it('accepts minimal valid entry', () => {
      expect(
        Value.Check(CreateDiaryEntrySchema, { content: 'Hello world' }),
      ).toBe(true);
    });

    it('accepts entry with all fields', () => {
      expect(
        Value.Check(CreateDiaryEntrySchema, {
          title: 'My Entry',
          content: 'Hello world',
          visibility: 'moltnet',
          tags: ['test', 'diary'],
        }),
      ).toBe(true);
    });

    it('rejects empty content', () => {
      expect(Value.Check(CreateDiaryEntrySchema, { content: '' })).toBe(false);
    });

    it('rejects content over 100k chars', () => {
      expect(
        Value.Check(CreateDiaryEntrySchema, {
          content: 'a'.repeat(100001),
        }),
      ).toBe(false);
    });

    it('rejects more than 20 tags', () => {
      const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
      expect(
        Value.Check(CreateDiaryEntrySchema, { content: 'test', tags }),
      ).toBe(false);
    });

    it('rejects tag over 50 chars', () => {
      expect(
        Value.Check(CreateDiaryEntrySchema, {
          content: 'test',
          tags: ['a'.repeat(51)],
        }),
      ).toBe(false);
    });

    it('rejects invalid visibility', () => {
      expect(
        Value.Check(CreateDiaryEntrySchema, {
          content: 'test',
          visibility: 'invalid',
        }),
      ).toBe(false);
    });
  });

  describe('UpdateDiaryEntrySchema', () => {
    it('accepts partial update with title only', () => {
      expect(Value.Check(UpdateDiaryEntrySchema, { title: 'New Title' })).toBe(
        true,
      );
    });

    it('accepts empty object (no required fields)', () => {
      expect(Value.Check(UpdateDiaryEntrySchema, {})).toBe(true);
    });
  });

  describe('DiarySearchSchema', () => {
    it('accepts search with query', () => {
      expect(Value.Check(DiarySearchSchema, { query: 'find me' })).toBe(true);
    });

    it('accepts empty search (all optional)', () => {
      expect(Value.Check(DiarySearchSchema, {})).toBe(true);
    });

    it('rejects query over 500 chars', () => {
      expect(Value.Check(DiarySearchSchema, { query: 'a'.repeat(501) })).toBe(
        false,
      );
    });

    it('rejects limit over 100', () => {
      expect(Value.Check(DiarySearchSchema, { limit: 101 })).toBe(false);
    });

    it('rejects negative offset', () => {
      expect(Value.Check(DiarySearchSchema, { offset: -1 })).toBe(false);
    });
  });

  describe('ShareEntrySchema', () => {
    it('accepts valid share request', () => {
      expect(Value.Check(ShareEntrySchema, { sharedWith: 'Claude' })).toBe(
        true,
      );
    });

    it('rejects missing sharedWith', () => {
      expect(Value.Check(ShareEntrySchema, {})).toBe(false);
    });
  });

  describe('SetVisibilitySchema', () => {
    it('accepts valid visibility', () => {
      expect(Value.Check(SetVisibilitySchema, { visibility: 'public' })).toBe(
        true,
      );
    });

    it('rejects missing visibility', () => {
      expect(Value.Check(SetVisibilitySchema, {})).toBe(false);
    });
  });
});

describe('Crypto schemas', () => {
  describe('SignRequestSchema', () => {
    it('accepts valid message', () => {
      expect(Value.Check(SignRequestSchema, { message: 'sign this' })).toBe(
        true,
      );
    });

    it('rejects empty message', () => {
      expect(Value.Check(SignRequestSchema, { message: '' })).toBe(false);
    });

    it('rejects message over 10k chars', () => {
      expect(
        Value.Check(SignRequestSchema, { message: 'a'.repeat(10001) }),
      ).toBe(false);
    });
  });

  describe('VerifyRequestSchema', () => {
    it('accepts valid verify request', () => {
      expect(
        Value.Check(VerifyRequestSchema, {
          message: 'verify me',
          signature: 'c2lnbmF0dXJl',
          publicKey: 'ed25519:AAAA',
        }),
      ).toBe(true);
    });

    it('rejects missing fields', () => {
      expect(Value.Check(VerifyRequestSchema, { message: 'test' })).toBe(false);
    });
  });
});

describe('AuthContextSchema', () => {
  const validContext = {
    identityId: '550e8400-e29b-41d4-a716-446655440000',
    moltbookName: 'Claude',
    publicKey: 'ed25519:AAAA',
    fingerprint: 'A1B2-C3D4-E5F6-07A8',
    clientId: 'hydra-client-123',
    scopes: ['diary:read', 'diary:write'],
  };

  it('accepts valid auth context', () => {
    expect(Value.Check(AuthContextSchema, validContext)).toBe(true);
  });

  it('rejects missing identityId', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { identityId, ...rest } = validContext;
    expect(Value.Check(AuthContextSchema, rest)).toBe(false);
  });

  it('rejects missing scopes', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { scopes, ...rest } = validContext;
    expect(Value.Check(AuthContextSchema, rest)).toBe(false);
  });
});

describe('Response schemas', () => {
  describe('ErrorResponseSchema', () => {
    it('accepts valid error', () => {
      expect(
        Value.Check(ErrorResponseSchema, {
          error: 'UNAUTHORIZED',
          message: 'Invalid token',
          statusCode: 401,
        }),
      ).toBe(true);
    });
  });

  describe('PaginatedResponseSchema', () => {
    it('creates a working paginated schema', () => {
      const schema = PaginatedResponseSchema(DiaryEntrySchema);
      expect(
        Value.Check(schema, {
          items: [],
          total: 0,
          limit: 20,
          offset: 0,
        }),
      ).toBe(true);
    });
  });
});
