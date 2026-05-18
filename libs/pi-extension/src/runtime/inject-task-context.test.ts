import { describe, expect, it, vi } from 'vitest';

import {
  injectTaskContext,
  type VmFsForContext,
} from './inject-task-context.js';

function mockFs(): VmFsForContext & {
  mkdir: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
} {
  const mkdir = vi.fn(async () => undefined);
  const writeFile = vi.fn(async () => undefined);
  return { mkdir, writeFile };
}

describe('injectTaskContext', () => {
  it('returns an inert result for an empty context array', async () => {
    const fs = mockFs();
    const out = await injectTaskContext({ context: [], fs });
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
    const out = await injectTaskContext({
      context: [{ slug: 'pack-fidelity', binding: 'skill', content }],
      fs,
    });

    expect(fs.mkdir).toHaveBeenCalledWith(
      '/moltnet-task-skills/pack-fidelity',
      { recursive: true },
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/moltnet-task-skills/pack-fidelity/SKILL.md',
      content,
      { mode: 0o644 },
    );
    expect(out.skills).toHaveLength(1);
    const skill = out.skills[0];
    expect(skill.name).toBe('pack-fidelity');
    expect(skill.filePath).toBe('/moltnet-task-skills/pack-fidelity/SKILL.md');
    expect(skill.baseDir).toBe('/moltnet-task-skills/pack-fidelity');
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
    const out = await injectTaskContext({
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
    const out = await injectTaskContext({
      context: [{ slug: 'eo', binding: 'skill', content }],
      fs,
    });
    expect(out.skills[0].disableModelInvocation).toBe(true);
  });

  it('falls back to slug-derived name + generic description without frontmatter', async () => {
    const fs = mockFs();
    const out = await injectTaskContext({
      context: [
        { slug: 'no-frontmatter', binding: 'skill', content: 'just text' },
      ],
      fs,
    });
    expect(out.skills[0].name).toBe('no-frontmatter');
    expect(out.skills[0].description).toBe(
      'Task-injected context skill (no-frontmatter)',
    );
  });

  it('concatenates prompt_prefix entries into systemPromptPrefix', async () => {
    const fs = mockFs();
    const out = await injectTaskContext({
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

  it('writes context_inline bytes into the workspace and injects a named prompt block', async () => {
    const fs = mockFs();
    const out = await injectTaskContext({
      context: [
        {
          slug: 'dbos-pack',
          binding: 'context_inline',
          content: '# Pack\nDo not start workflows inside transactions.',
        },
      ],
      fs,
    });
    expect(fs.mkdir).toHaveBeenCalledWith('/workspace/.moltnet/context', {
      recursive: true,
    });
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/workspace/.moltnet/context/dbos-pack.md',
      '# Pack\nDo not start workflows inside transactions.',
      { mode: 0o644 },
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/workspace/context-pack.md',
      expect.stringContaining('## dbos-pack'),
      { mode: 0o644 },
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/workspace/AGENTS.md',
      expect.stringContaining('## dbos-pack'),
      { mode: 0o644 },
    );
    expect(fs.mkdir).toHaveBeenCalledWith('/workspace/.claude', {
      recursive: true,
    });
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/workspace/.claude/CLAUDE.md',
      '@../context-pack.md\n',
      { mode: 0o644 },
    );
    expect(out.systemPromptPrefix).toContain('### Injected Task Context');
    expect(out.systemPromptPrefix).toContain('`dbos-pack`');
  });

  it('concatenates user_inline entries into userInlineSuffix', async () => {
    const fs = mockFs();
    const out = await injectTaskContext({
      context: [{ slug: 'a', binding: 'user_inline', content: 'hello' }],
      fs,
    });
    expect(out.userInlineSuffix).toBe('hello');
    expect(out.systemPromptPrefix).toBe('');
  });

  it('exercises all four bindings end-to-end', async () => {
    const fs = mockFs();
    const out = await injectTaskContext({
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
    expect(fs.writeFile).toHaveBeenCalledTimes(5);
    expect(out.systemPromptPrefix).toContain('### Injected Task Context');
    expect(out.systemPromptPrefix).toContain('PREFIX');
    expect(out.userInlineSuffix).toBe('INLINE');
    expect(out.skills).toHaveLength(1);
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
    const out = await injectTaskContext({
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
    const out = await injectTaskContext({
      context: [{ slug: 'broken-fm', binding: 'skill', content }],
      fs,
    });
    // Parser threw → fallback metadata, but the skill is still
    // delivered (file written, Skill object emitted).
    expect(out.skills).toHaveLength(1);
    expect(out.skills[0].name).toBe('broken-fm');
    expect(out.skills[0].description).toBe(
      'Task-injected context skill (broken-fm)',
    );
    expect(fs.writeFile).toHaveBeenCalledOnce();
  });

  it('propagates writeFile rejections to the caller', async () => {
    const fs = mockFs();
    fs.writeFile.mockRejectedValueOnce(new Error('ENOSPC'));
    await expect(
      injectTaskContext({
        context: [{ slug: 'x', binding: 'skill', content: 'y' }],
        fs,
      }),
    ).rejects.toThrow('ENOSPC');
  });

  it('propagates mkdir rejections to the caller', async () => {
    const fs = mockFs();
    fs.mkdir.mockRejectedValueOnce(new Error('EACCES'));
    await expect(
      injectTaskContext({
        context: [{ slug: 'x', binding: 'skill', content: 'y' }],
        fs,
      }),
    ).rejects.toThrow('EACCES');
  });
});
