import { describe, expect, it, vi } from 'vitest';

import {
  type ContextDeliverer,
  mergeRuntimeProfileContext,
  resolveTaskContext,
} from './context-bindings.js';

function mockDeliverer(): ContextDeliverer & {
  skill: ReturnType<typeof vi.fn>;
  contextFile: ReturnType<typeof vi.fn>;
} {
  const skill = vi.fn(async () => undefined);
  const contextFile = vi.fn(async () => undefined);
  return { skill, contextFile };
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
    expect(deliverer.contextFile).not.toHaveBeenCalled();
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

  it('persists context_inline content and injects a named prompt block', async () => {
    const deliverer = mockDeliverer();
    const out = await resolveTaskContext({
      context: [
        {
          slug: 'dbos-pack',
          binding: 'context_inline',
          content: '# Pack\nDo not start workflows inside transactions.',
        },
      ],
      deliver: deliverer,
    });
    expect(deliverer.contextFile).toHaveBeenCalledWith({
      slug: 'dbos-pack',
      content: '# Pack\nDo not start workflows inside transactions.',
      suggestedFileName: 'dbos-pack.md',
    });
    expect(out.systemPromptPrefix).toContain('### Injected Task Context');
    expect(out.systemPromptPrefix).toContain('`dbos-pack`');
    expect(out.systemPromptPrefix).toContain(
      'Do not start workflows inside transactions.',
    );
    expect(out.systemPromptPrefix).toContain('/moltnet-task-context/context');
    expect(out.systemPromptPrefix).toContain('workspace mirror files');
    expect(out.systemPromptPrefix).not.toContain('context-pack.md');
    expect(out.systemPromptPrefix).not.toContain('AGENTS.md');
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

  it('delivers a duplicate (slug, content) pair only once', async () => {
    // Re-declaring the same skill content under the same slug is a
    // benign idempotent restatement; the deliverer must NOT be called a
    // second time. Non-idempotent deliverers (append-mode, audit-log
    // writers) would otherwise double-write the same bytes.
    const deliverer = mockDeliverer();
    const out = await resolveTaskContext({
      context: [
        { slug: 'shared', binding: 'skill', content: 'same' },
        { slug: 'shared', binding: 'skill', content: 'same' },
      ],
      deliver: deliverer,
    });
    expect(deliverer.skill).toHaveBeenCalledTimes(1);
    // Both entries appear in the audit log so the proposer's intent
    // (the duplicate declaration) is recoverable.
    expect(out.injected).toHaveLength(2);
  });

  it('exercises all four bindings end-to-end', async () => {
    const deliverer = mockDeliverer();
    const out = await resolveTaskContext({
      context: [
        { slug: 'a', binding: 'skill', content: '# Skill' },
        { slug: 'b', binding: 'context_inline', content: '# Context' },
        { slug: 'c', binding: 'prompt_prefix', content: 'PREFIX' },
        { slug: 'd', binding: 'user_inline', content: 'INLINE' },
      ],
      deliver: deliverer,
    });

    expect(out.injected.map((r) => r.binding)).toEqual([
      'skill',
      'context_inline',
      'prompt_prefix',
      'user_inline',
    ]);
    expect(deliverer.skill).toHaveBeenCalledTimes(1);
    expect(deliverer.contextFile).toHaveBeenCalledTimes(1);
    expect(deliverer.skill).toHaveBeenCalledWith({
      slug: 'a',
      content: '# Skill',
    });
    expect(out.systemPromptPrefix).toContain('### Injected Task Context');
    expect(out.systemPromptPrefix).toContain('PREFIX');
    expect(out.userInlineSuffix).toBe('INLINE');
  });
});

describe('mergeRuntimeProfileContext', () => {
  it('uses profile context when task context is empty', () => {
    expect(
      mergeRuntimeProfileContext(
        [{ slug: 'profile-skill', binding: 'skill', content: '# Profile' }],
        [],
      ),
    ).toEqual([
      { slug: 'profile-skill', binding: 'skill', content: '# Profile' },
    ]);
  });

  it('keeps profile entries before task entries when slugs do not collide', () => {
    expect(
      mergeRuntimeProfileContext(
        [{ slug: 'profile-skill', binding: 'skill', content: '# Profile' }],
        [{ slug: 'task-skill', binding: 'skill', content: '# Task' }],
      ).map((ref) => ref.slug),
    ).toEqual(['profile-skill', 'task-skill']);
  });

  it('lets task context override profile context by slug', () => {
    expect(
      mergeRuntimeProfileContext(
        [
          { slug: 'shared', binding: 'skill', content: '# Profile' },
          { slug: 'profile-only', binding: 'skill', content: '# Keep' },
        ],
        [{ slug: 'shared', binding: 'prompt_prefix', content: 'Task wins' }],
      ),
    ).toEqual([
      { slug: 'profile-only', binding: 'skill', content: '# Keep' },
      { slug: 'shared', binding: 'prompt_prefix', content: 'Task wins' },
    ]);
  });

  it('accepts five profile entries plus five task entries', () => {
    const profileContext = Array.from({ length: 5 }, (_, i) => ({
      slug: `profile-${i}`,
      binding: 'skill' as const,
      content: `profile ${i}`,
    }));
    const taskContext = Array.from({ length: 5 }, (_, i) => ({
      slug: `task-${i}`,
      binding: 'skill' as const,
      content: `task ${i}`,
    }));

    expect(
      mergeRuntimeProfileContext(profileContext, taskContext).map(
        (ref) => ref.slug,
      ),
    ).toEqual([
      'profile-0',
      'profile-1',
      'profile-2',
      'profile-3',
      'profile-4',
      'task-0',
      'task-1',
      'task-2',
      'task-3',
      'task-4',
    ]);
  });

  it('rejects more than ten effective context entries', () => {
    const profileContext = Array.from({ length: 6 }, (_, i) => ({
      slug: `profile-${i}`,
      binding: 'skill' as const,
      content: `profile ${i}`,
    }));
    const taskContext = Array.from({ length: 5 }, (_, i) => ({
      slug: `task-${i}`,
      binding: 'skill' as const,
      content: `task ${i}`,
    }));

    expect(() =>
      mergeRuntimeProfileContext(profileContext, taskContext),
    ).toThrow(/maximum is 10/);
  });

  it('counts entries after task slug overrides remove profile defaults', () => {
    const profileContext = Array.from({ length: 6 }, (_, i) => ({
      slug: i === 0 ? 'shared' : `profile-${i}`,
      binding: 'skill' as const,
      content: `profile ${i}`,
    }));
    const taskContext = Array.from({ length: 5 }, (_, i) => ({
      slug: i === 0 ? 'shared' : `task-${i}`,
      binding: 'skill' as const,
      content: `task ${i}`,
    }));

    expect(
      mergeRuntimeProfileContext(profileContext, taskContext).map(
        (ref) => ref.slug,
      ),
    ).toEqual([
      'profile-1',
      'profile-2',
      'profile-3',
      'profile-4',
      'profile-5',
      'shared',
      'task-1',
      'task-2',
      'task-3',
      'task-4',
    ]);
  });
});
