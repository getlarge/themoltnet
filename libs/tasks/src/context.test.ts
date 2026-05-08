import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import { ContextBinding, ContextRef, TaskContext } from './context.js';

describe('ContextBinding', () => {
  it('accepts the three V1 binding kinds', () => {
    expect(Value.Check(ContextBinding, 'skill')).toBe(true);
    expect(Value.Check(ContextBinding, 'prompt_prefix')).toBe(true);
    expect(Value.Check(ContextBinding, 'user_inline')).toBe(true);
  });

  it('rejects unknown bindings (Tier-2 names not yet enabled)', () => {
    expect(Value.Check(ContextBinding, 'reference_file')).toBe(false);
    expect(Value.Check(ContextBinding, 'mcp_resource')).toBe(false);
    expect(Value.Check(ContextBinding, 'arbitrary')).toBe(false);
  });
});

describe('ContextRef', () => {
  it('round-trips a valid ref', () => {
    const ref = { cid: 'bafyreigh2akiscaildc', binding: 'skill' as const };
    expect(Value.Check(ContextRef, ref)).toBe(true);
  });

  it('rejects empty cid', () => {
    expect(Value.Check(ContextRef, { cid: '', binding: 'skill' })).toBe(false);
  });

  it('rejects extra fields', () => {
    expect(
      Value.Check(ContextRef, { cid: 'bafy', binding: 'skill', extra: 1 }),
    ).toBe(false);
  });
});

describe('TaskContext', () => {
  it('accepts an empty array (baseline variant)', () => {
    expect(Value.Check(TaskContext, [])).toBe(true);
  });

  it('rejects more than 5 items', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      cid: `bafy-${i}`,
      binding: 'skill' as const,
    }));
    expect(Value.Check(TaskContext, six)).toBe(false);
  });
});
