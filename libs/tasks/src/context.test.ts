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
    const ref = {
      slug: 'pack-fidelity',
      binding: 'skill' as const,
      content: '# Skill body\n',
    };
    expect(Value.Check(ContextRef, ref)).toBe(true);
  });

  it('rejects empty content', () => {
    expect(
      Value.Check(ContextRef, {
        slug: 'x',
        binding: 'skill',
        content: '',
      }),
    ).toBe(false);
  });

  it('rejects slug with disallowed characters', () => {
    expect(
      Value.Check(ContextRef, {
        slug: 'has spaces',
        binding: 'skill',
        content: 'x',
      }),
    ).toBe(false);
    expect(
      Value.Check(ContextRef, {
        slug: 'has/slash',
        binding: 'skill',
        content: 'x',
      }),
    ).toBe(false);
  });

  it('rejects extra fields', () => {
    expect(
      Value.Check(ContextRef, {
        slug: 'x',
        binding: 'skill',
        content: 'x',
        cid: 'leftover',
      }),
    ).toBe(false);
  });
});

describe('TaskContext', () => {
  it('accepts an empty array (baseline variant)', () => {
    expect(Value.Check(TaskContext, [])).toBe(true);
  });

  it('rejects more than 5 items', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      slug: `item-${i}`,
      binding: 'skill' as const,
      content: 'x',
    }));
    expect(Value.Check(TaskContext, six)).toBe(false);
  });
});
