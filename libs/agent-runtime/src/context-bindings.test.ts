import { describe, expect, it, vi } from 'vitest';

import {
  type ContextDeliverer,
  type FlaggedContentCheck,
  resolveTaskContext,
} from './context-bindings.js';

const ok: FlaggedContentCheck = async () => ({ flagged: false });

function makeFetcher(map: Record<string, Uint8Array>) {
  return async (cid: string) => {
    const bytes = map[cid];
    if (!bytes) throw new Error(`cid ${cid} not found`);
    return { cid, bytes };
  };
}

function mockDeliverer(): ContextDeliverer & {
  skill: ReturnType<typeof vi.fn>;
} {
  const skill = vi.fn(async () => undefined);
  return { skill };
}

describe('resolveTaskContext', () => {
  it('returns an empty result for an empty context array (baseline)', async () => {
    const deliverer = mockDeliverer();
    const out = await resolveTaskContext({
      context: [],
      fetch: makeFetcher({}),
      verifyCid: async () => true,
      isFlagged: ok,
      deliver: deliverer,
    });
    expect(out.injected).toHaveLength(0);
    expect(deliverer.skill).not.toHaveBeenCalled();
    expect(out.systemPromptPrefix).toBe('');
    expect(out.userInlineSuffix).toBe('');
  });

  it('writes skill bytes through the skill deliverer', async () => {
    const bytes = new TextEncoder().encode('# Skill body');
    const deliverer = mockDeliverer();
    const out = await resolveTaskContext({
      context: [{ cid: 'bafyabc', binding: 'skill' }],
      fetch: makeFetcher({ bafyabc: bytes }),
      verifyCid: async () => true,
      isFlagged: ok,
      deliver: deliverer,
    });
    expect(deliverer.skill).toHaveBeenCalledWith({
      slug: 'bafyabc',
      bytes,
    });
    expect(out.injected).toEqual([
      expect.objectContaining({ cid: 'bafyabc', binding: 'skill' }),
    ]);
  });

  it('concatenates prompt_prefix items in declared order', async () => {
    const a = new TextEncoder().encode('AAA');
    const b = new TextEncoder().encode('BBB');
    const out = await resolveTaskContext({
      context: [
        { cid: 'a', binding: 'prompt_prefix' },
        { cid: 'b', binding: 'prompt_prefix' },
      ],
      fetch: makeFetcher({ a, b }),
      verifyCid: async () => true,
      isFlagged: ok,
      deliver: mockDeliverer(),
    });
    expect(out.systemPromptPrefix).toBe('AAA\n\n---\n\nBBB');
  });

  it('concatenates user_inline items in declared order', async () => {
    const a = new TextEncoder().encode('hello');
    const out = await resolveTaskContext({
      context: [{ cid: 'a', binding: 'user_inline' }],
      fetch: makeFetcher({ a }),
      verifyCid: async () => true,
      isFlagged: ok,
      deliver: mockDeliverer(),
    });
    expect(out.userInlineSuffix).toBe('hello');
  });

  it('throws when verifyCid returns false', async () => {
    await expect(
      resolveTaskContext({
        context: [{ cid: 'a', binding: 'skill' }],
        fetch: makeFetcher({ a: new TextEncoder().encode('x') }),
        verifyCid: async () => false,
        isFlagged: ok,
        deliver: mockDeliverer(),
      }),
    ).rejects.toThrow(/cid mismatch/i);
  });

  it('throws when isFlagged reports flagged content', async () => {
    await expect(
      resolveTaskContext({
        context: [{ cid: 'a', binding: 'skill' }],
        fetch: makeFetcher({ a: new TextEncoder().encode('x') }),
        verifyCid: async () => true,
        isFlagged: async () => ({ flagged: true, reason: 'injection_risk' }),
        deliver: mockDeliverer(),
      }),
    ).rejects.toThrow(/flagged/i);
  });

  it('refuses skill slug collisions on distinct CIDs', async () => {
    // Two CIDs that share the same first 12 alphanumeric chars produce
    // colliding slugs. Resolver must fail loudly rather than overwrite.
    const a = new TextEncoder().encode('alpha');
    const b = new TextEncoder().encode('beta');
    await expect(
      resolveTaskContext({
        context: [
          { cid: 'bafyreiaaaaaa-1', binding: 'skill' },
          { cid: 'bafyreiaaaaaa-2', binding: 'skill' },
        ],
        fetch: makeFetcher({
          'bafyreiaaaaaa-1': a,
          'bafyreiaaaaaa-2': b,
        }),
        verifyCid: async () => true,
        isFlagged: ok,
        deliver: mockDeliverer(),
      }),
    ).rejects.toThrow(/slug collision/i);
  });

  it('exercises all three bindings end-to-end', async () => {
    const skillBytes = new TextEncoder().encode('# Skill');
    const prefixBytes = new TextEncoder().encode('PREFIX');
    const inlineBytes = new TextEncoder().encode('INLINE');
    const deliverer = mockDeliverer();
    const out = await resolveTaskContext({
      context: [
        { cid: 'cid1', binding: 'skill' },
        { cid: 'cid2', binding: 'prompt_prefix' },
        { cid: 'cid3', binding: 'user_inline' },
      ],
      fetch: makeFetcher({
        cid1: skillBytes,
        cid2: prefixBytes,
        cid3: inlineBytes,
      }),
      verifyCid: async () => true,
      isFlagged: ok,
      deliver: deliverer,
    });

    expect(out.injected.map((r) => r.binding)).toEqual([
      'skill',
      'prompt_prefix',
      'user_inline',
    ]);
    expect(deliverer.skill).toHaveBeenCalledTimes(1);
    expect(deliverer.skill).toHaveBeenCalledWith({
      slug: 'cid1',
      bytes: skillBytes,
    });
    expect(out.systemPromptPrefix).toBe('PREFIX');
    expect(out.userInlineSuffix).toBe('INLINE');
  });
});
