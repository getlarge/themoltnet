import { describe, expect, it, vi } from 'vitest';

import {
  injectRuntimeContext,
  mergeRuntimeProfileContext,
  resolveEffectiveRuntimeContext,
  type VmFsForContext,
} from './runtime-context.js';

function mockFs(): VmFsForContext & {
  mkdir: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
} {
  const mkdir = vi.fn(async () => undefined);
  const writeFile = vi.fn(async () => undefined);
  return { mkdir, writeFile };
}

describe('resolveEffectiveRuntimeContext', () => {
  it('merges validated runtime profile context with task context', () => {
    expect(
      resolveEffectiveRuntimeContext({
        runtimeProfileContext: [
          { slug: 'profile-only', binding: 'skill', content: '# Profile' },
          { slug: 'shared', binding: 'skill', content: '# Old' },
        ],
        rawTaskContext: [
          { slug: 'shared', binding: 'context_inline', content: '# New' },
        ],
      }),
    ).toEqual([
      { slug: 'profile-only', binding: 'skill', content: '# Profile' },
      { slug: 'shared', binding: 'context_inline', content: '# New' },
    ]);
  });

  it('rejects invalid task context before injection', () => {
    expect(() =>
      resolveEffectiveRuntimeContext({
        runtimeProfileContext: [],
        rawTaskContext: [{ slug: 'bad', binding: 'unknown', content: 'x' }],
      }),
    ).toThrow(/task\.input\.context failed TaskContext validation/);
  });

  it('rejects invalid runtime profile context before injection', () => {
    expect(() =>
      resolveEffectiveRuntimeContext({
        runtimeProfileContext: [
          { slug: 'bad', binding: 'unknown', content: 'x' } as never,
        ],
        rawTaskContext: [],
      }),
    ).toThrow(/runtime profile context failed TaskContext validation/);
  });
});

describe('mergeRuntimeProfileContext', () => {
  it('is re-exported from the Pi runtime context module for compatibility', () => {
    expect(
      mergeRuntimeProfileContext(
        [{ slug: 'profile-skill', binding: 'skill', content: '# Profile' }],
        [{ slug: 'task-skill', binding: 'skill', content: '# Task' }],
      ).map((ref) => ref.slug),
    ).toEqual(['profile-skill', 'task-skill']);
  });
});

describe('injectRuntimeContext', () => {
  it('returns an inert result for an empty context array', async () => {
    const fs = mockFs();
    const out = await injectRuntimeContext({
      guestWorkspace: '/guest/workspace',
      context: [],
      fs,
    });
    expect(out.injected).toEqual([]);
    expect(out.skills).toEqual([]);
    expect(out.systemPromptPrefix).toBe('');
    expect(out.userInlineSuffix).toBe('');
    expect(fs.mkdir).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('writes a skill into the VM and returns a synthetic Skill object', async () => {
    const fs = mockFs();
    const content = '# Pack fidelity skill body';
    const out = await injectRuntimeContext({
      guestWorkspace: '/guest/workspace',
      context: [{ slug: 'pack-fidelity', binding: 'skill', content }],
      fs,
    });

    expect(fs.mkdir).toHaveBeenCalledWith(
      '/moltnet-task-context/skills/pack-fidelity',
      { recursive: true },
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/moltnet-task-context/skills/pack-fidelity/SKILL.md',
      content,
      { mode: 0o644 },
    );
    expect(out.skills).toHaveLength(1);
    const skill = out.skills[0];
    expect(skill.name).toBe('pack-fidelity');
    expect(skill.filePath).toBe(
      '/moltnet-task-context/skills/pack-fidelity/SKILL.md',
    );
    expect(skill.baseDir).toBe('/moltnet-task-context/skills/pack-fidelity');
    expect(skill.disableModelInvocation).toBe(false);
  });

  it('extracts name and description from YAML frontmatter when present', async () => {
    const fs = mockFs();
    const content = [
      '---',
      'name: rendered-pack-fidelity',
      'description: Use when judging rendered packs against their source.',
      '---',
      '# Body',
    ].join('\n');
    const out = await injectRuntimeContext({
      guestWorkspace: '/guest/workspace',
      context: [{ slug: 'pack-x', binding: 'skill', content }],
      fs,
    });
    expect(out.skills[0].name).toBe('rendered-pack-fidelity');
    expect(out.skills[0].description).toBe(
      'Use when judging rendered packs against their source.',
    );
  });

  it('honours disable-model-invocation: true in frontmatter', async () => {
    const fs = mockFs();
    const content = [
      '---',
      'name: explicit-only',
      'disable-model-invocation: true',
      '---',
      'body',
    ].join('\n');
    const out = await injectRuntimeContext({
      guestWorkspace: '/guest/workspace',
      context: [{ slug: 'eo', binding: 'skill', content }],
      fs,
    });
    expect(out.skills[0].disableModelInvocation).toBe(true);
  });

  it('falls back to slug-derived name + generic description without frontmatter', async () => {
    const fs = mockFs();
    const out = await injectRuntimeContext({
      guestWorkspace: '/guest/workspace',
      context: [
        { slug: 'no-frontmatter', binding: 'skill', content: 'just text' },
      ],
      fs,
    });
    expect(out.skills[0].name).toBe('no-frontmatter');
    expect(out.skills[0].description).toBe(
      'Runtime-injected context skill (no-frontmatter)',
    );
  });

  it('concatenates prompt_prefix entries into systemPromptPrefix', async () => {
    const fs = mockFs();
    const out = await injectRuntimeContext({
      guestWorkspace: '/guest/workspace',
      context: [
        { slug: 'a', binding: 'prompt_prefix', content: 'AAA' },
        { slug: 'b', binding: 'prompt_prefix', content: 'BBB' },
      ],
      fs,
    });
    expect(out.systemPromptPrefix).toBe('AAA\n\n---\n\nBBB');
    expect(out.userInlineSuffix).toBe('');
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('writes context_inline bytes into the task-context mount and injects a named prompt block', async () => {
    const fs = mockFs();
    const out = await injectRuntimeContext({
      guestWorkspace: '/guest/workspace',
      context: [
        {
          slug: 'dbos-pack',
          binding: 'context_inline',
          content: '# Pack\nDo not start workflows inside transactions.',
        },
      ],
      fs,
    });
    expect(fs.mkdir).toHaveBeenCalledWith('/moltnet-task-context/context', {
      recursive: true,
    });
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/moltnet-task-context/context/dbos-pack.md',
      '# Pack\nDo not start workflows inside transactions.',
      { mode: 0o644 },
    );
    const writtenPaths = fs.writeFile.mock.calls.map(([filePath]) => filePath);
    expect(writtenPaths).not.toContain('/guest/workspace/context-pack.md');
    expect(writtenPaths).not.toContain('/guest/workspace/AGENTS.md');
    expect(writtenPaths).not.toContain('/guest/workspace/.claude/CLAUDE.md');
    expect(out.systemPromptPrefix).toContain('### Injected Task Context');
    expect(out.systemPromptPrefix).toContain('`dbos-pack`');
  });

  it('concatenates user_inline entries into userInlineSuffix', async () => {
    const fs = mockFs();
    const out = await injectRuntimeContext({
      guestWorkspace: '/guest/workspace',
      context: [{ slug: 'a', binding: 'user_inline', content: 'hello' }],
      fs,
    });
    expect(out.userInlineSuffix).toBe('hello');
    expect(out.systemPromptPrefix).toBe('');
  });

  it('exercises all four bindings end-to-end', async () => {
    const fs = mockFs();
    const out = await injectRuntimeContext({
      guestWorkspace: '/guest/workspace',
      context: [
        { slug: 's1', binding: 'skill', content: '# Skill' },
        { slug: 'c1', binding: 'context_inline', content: '# Context' },
        { slug: 'p1', binding: 'prompt_prefix', content: 'PREFIX' },
        { slug: 'u1', binding: 'user_inline', content: 'INLINE' },
      ],
      fs,
    });
    expect(out.injected.map((r) => r.binding)).toEqual([
      'skill',
      'context_inline',
      'prompt_prefix',
      'user_inline',
    ]);
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
    expect(out.systemPromptPrefix).toContain('### Injected Task Context');
    expect(out.systemPromptPrefix).toContain('PREFIX');
    expect(out.userInlineSuffix).toBe('INLINE');
    expect(out.skills).toHaveLength(1);
  });

  it('does not write task context into the mounted workspace', async () => {
    const fs = mockFs();
    await injectRuntimeContext({
      guestWorkspace: '/guest/workspace',
      context: [
        {
          slug: 'review-bundle',
          binding: 'context_inline',
          content: '# Review Bundle',
        },
      ],
      fs,
    });

    const writtenPaths = fs.writeFile.mock.calls.map(([filePath]) =>
      String(filePath),
    );
    expect(writtenPaths).not.toContain('/guest/workspace/context-pack.md');
    expect(writtenPaths).not.toContain('/guest/workspace/AGENTS.md');
    expect(writtenPaths).not.toContain('/guest/workspace/.claude/CLAUDE.md');
    expect(
      writtenPaths.every((filePath) => !filePath.startsWith('/guest/')),
    ).toBe(true);
  });

  it('clips overlong frontmatter values to pi-style bounds', async () => {
    const fs = mockFs();
    const longName = 'x'.repeat(100); // > 64
    const longDesc = 'y'.repeat(2000); // > 1024
    const content = [
      '---',
      `name: ${longName}`,
      `description: ${longDesc}`,
      '---',
      'body',
    ].join('\n');
    const out = await injectRuntimeContext({
      guestWorkspace: '/guest/workspace',
      context: [{ slug: 'big', binding: 'skill', content }],
      fs,
    });
    expect(out.skills[0].name.length).toBe(64);
    expect(out.skills[0].description.length).toBe(1024);
  });

  it('falls back to slug-derived metadata when YAML frontmatter is malformed', async () => {
    const fs = mockFs();
    // Unbalanced anchors / bogus structure — the YAML parser throws
    // on this rather than returning an empty object.
    const content = [
      '---',
      'name: *unclosed-anchor',
      '  : nested-bad',
      '---',
      'real body bytes',
    ].join('\n');
    const out = await injectRuntimeContext({
      guestWorkspace: '/guest/workspace',
      context: [{ slug: 'broken-fm', binding: 'skill', content }],
      fs,
    });
    // Parser threw → fallback metadata, but the skill is still
    // delivered (file written, Skill object emitted).
    expect(out.skills).toHaveLength(1);
    expect(out.skills[0].name).toBe('broken-fm');
    expect(out.skills[0].description).toBe(
      'Runtime-injected context skill (broken-fm)',
    );
    expect(fs.writeFile).toHaveBeenCalledOnce();
  });

  it('propagates writeFile rejections to the caller', async () => {
    const fs = mockFs();
    fs.writeFile.mockRejectedValueOnce(new Error('ENOSPC'));
    await expect(
      injectRuntimeContext({
        guestWorkspace: '/guest/workspace',
        context: [{ slug: 'x', binding: 'skill', content: 'y' }],
        fs,
      }),
    ).rejects.toThrow('ENOSPC');
  });

  it('propagates mkdir rejections to the caller', async () => {
    const fs = mockFs();
    fs.mkdir.mockRejectedValueOnce(new Error('EACCES'));
    await expect(
      injectRuntimeContext({
        guestWorkspace: '/guest/workspace',
        context: [{ slug: 'x', binding: 'skill', content: 'y' }],
        fs,
      }),
    ).rejects.toThrow('EACCES');
  });
});
