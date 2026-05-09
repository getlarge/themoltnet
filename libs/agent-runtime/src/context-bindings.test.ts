import { describe, expect, it, vi } from 'vitest';

import {
  type ContextDeliverer,
  resolveTaskContext,
} from './context-bindings.js';

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
      deliver: deliverer,
    });
    expect(out.injected).toHaveLength(0);
    expect(deliverer.skill).not.toHaveBeenCalled();
    expect(out.systemPromptPrefix).toBe('');
    expect(out.userInlineSuffix).toBe('');
  });

  it('writes skill content through the skill deliverer', async () => {
    const deliverer = mockDeliverer();
    const out = await resolveTaskContext({
      context: [
        { slug: 'pack-fidelity', binding: 'skill', content: '# Skill body' },
      ],
      deliver: deliverer,
    });
    expect(deliverer.skill).toHaveBeenCalledWith({
      slug: 'pack-fidelity',
      content: '# Skill body',
    });
    expect(out.injected).toEqual([
      expect.objectContaining({ slug: 'pack-fidelity', binding: 'skill' }),
    ]);
  });

  it('concatenates prompt_prefix items in declared order', async () => {
    const out = await resolveTaskContext({
      context: [
        { slug: 'a', binding: 'prompt_prefix', content: 'AAA' },
        { slug: 'b', binding: 'prompt_prefix', content: 'BBB' },
      ],
      deliver: mockDeliverer(),
    });
    expect(out.systemPromptPrefix).toBe('AAA\n\n---\n\nBBB');
  });

  it('concatenates user_inline items in declared order', async () => {
    const out = await resolveTaskContext({
      context: [{ slug: 'a', binding: 'user_inline', content: 'hello' }],
      deliver: mockDeliverer(),
    });
    expect(out.userInlineSuffix).toBe('hello');
  });

  it('refuses skill slug collisions on distinct content', async () => {
    await expect(
      resolveTaskContext({
        context: [
          { slug: 'shared', binding: 'skill', content: 'one' },
          { slug: 'shared', binding: 'skill', content: 'two' },
        ],
        deliver: mockDeliverer(),
      }),
    ).rejects.toThrow(/slug collision/i);
  });

  it('allows duplicate skill entries with identical content (idempotent)', async () => {
    const deliverer = mockDeliverer();
    await expect(
      resolveTaskContext({
        context: [
          { slug: 'shared', binding: 'skill', content: 'same' },
          { slug: 'shared', binding: 'skill', content: 'same' },
        ],
        deliver: deliverer,
      }),
    ).resolves.toBeDefined();
    expect(deliverer.skill).toHaveBeenCalledTimes(2);
  });

  it('exercises all three bindings end-to-end', async () => {
    const deliverer = mockDeliverer();
    const out = await resolveTaskContext({
      context: [
        { slug: 'a', binding: 'skill', content: '# Skill' },
        { slug: 'b', binding: 'prompt_prefix', content: 'PREFIX' },
        { slug: 'c', binding: 'user_inline', content: 'INLINE' },
      ],
      deliver: deliverer,
    });

    expect(out.injected.map((r) => r.binding)).toEqual([
      'skill',
      'prompt_prefix',
      'user_inline',
    ]);
    expect(deliverer.skill).toHaveBeenCalledTimes(1);
    expect(deliverer.skill).toHaveBeenCalledWith({
      slug: 'a',
      content: '# Skill',
    });
    expect(out.systemPromptPrefix).toBe('PREFIX');
    expect(out.userInlineSuffix).toBe('INLINE');
  });
});
