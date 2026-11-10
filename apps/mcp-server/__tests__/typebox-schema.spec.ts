import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';

import { typebox, typeboxValidator } from '../src/typebox-schema.js';

const EntriesSearch = Type.Object({
  query: Type.String({ minLength: 1, description: 'Search text' }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});

describe('typebox()', () => {
  it('exposes the TypeBox schema unchanged as JSON Schema', () => {
    const standard = typebox(EntriesSearch);

    const json = standard['~standard'].jsonSchema.input({
      target: 'draft-2020-12',
    });

    expect(JSON.parse(JSON.stringify(json))).toEqual(
      JSON.parse(JSON.stringify(EntriesSearch)),
    );
  });

  it('accepts valid input and returns it as the typed value', async () => {
    const standard = typebox(EntriesSearch);

    const result = await standard['~standard'].validate({
      query: 'diary',
      limit: 5,
    });

    expect(result).toEqual({ value: { query: 'diary', limit: 5 } });
  });

  it('rejects invalid input with TypeBox error messages', async () => {
    const standard = typebox(EntriesSearch);

    const result = await standard['~standard'].validate({
      query: '',
      limit: 99,
    });

    expect('issues' in result && result.issues).toBeTruthy();
    const messages = JSON.stringify(result);
    expect(messages).toContain('/query');
    expect(messages).toContain('/limit');
  });

  it('returns the same adapter for the same schema', () => {
    expect(typebox(EntriesSearch)).toBe(typebox(EntriesSearch));
  });
});

describe('typeboxValidator', () => {
  it('reuses one compiled validator per schema object', () => {
    const first = typeboxValidator.getValidator(EntriesSearch as never);
    const second = typeboxValidator.getValidator(EntriesSearch as never);

    expect(first({ query: 'x' })).toEqual({
      valid: true,
      data: { query: 'x' },
      errorMessage: undefined,
    });
    expect(second({})).toMatchObject({ valid: false });
  });
});
