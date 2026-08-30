import {
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  computeSkillFolderHash,
  installManagedSkills,
  MANAGED_SKILLS,
  runSkillsCli,
  type SkillsCliRunner,
} from './skills.js';

const tmpRoot = join(
  tmpdir(),
  `legreffier-skills-test-${Math.random().toString(36).slice(2)}`,
);

beforeEach(async () => {
  await mkdir(tmpRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function writeSkill(
  root: string,
  name: string,
  companionFiles: Record<string, string> = {},
): Promise<void> {
  const skillDir = join(root, '.agents', 'skills', name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} test fixture\n---\n# ${name}\n`,
    'utf-8',
  );
  for (const [path, content] of Object.entries(companionFiles)) {
    const filePath = join(skillDir, path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf-8');
  }
}

async function writeManagedResult(
  repoDir: string,
  existingSkills: Record<string, unknown> = {},
  mutate?: (lock: Record<string, unknown>) => void,
): Promise<void> {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf-8'),
  ) as { version: string };
  const skills: Record<string, unknown> = { ...existingSkills };
  for (const name of MANAGED_SKILLS) {
    await writeSkill(repoDir, name, {
      ...(name === 'legreffier-explore'
        ? { 'references/nested.md': 'nested reference' }
        : {}),
    });
    skills[name] = {
      source: 'getlarge/themoltnet',
      ref: `legreffier-v${packageJson.version}`,
      sourceType: 'github',
      skillPath: `.agents/skills/${name}/SKILL.md`,
      computedHash: await computeSkillFolderHash(
        join(repoDir, '.agents', 'skills', name),
      ),
    };
  }
  mutate?.(skills);
  await writeFile(
    join(repoDir, 'skills-lock.json'),
    `${JSON.stringify({ version: 1, skills }, null, 2)}\n`,
    'utf-8',
  );
}

describe('runSkillsCli', () => {
  it('installs recursive skill files and owns agent discovery paths', async () => {
    const source = join(tmpRoot, 'source');
    const claudeTarget = join(tmpRoot, 'claude-target');
    const nativeTarget = join(tmpRoot, 'native-target');
    await mkdir(claudeTarget, { recursive: true });
    await mkdir(nativeTarget, { recursive: true });
    await writeSkill(source, 'legreffier');
    await writeSkill(source, 'legreffier-explore', {
      'references/nested/example.yaml': 'operator_controls: {}',
      'scripts/check.sh': '#!/bin/sh\n',
    });
    await writeSkill(source, 'legreffier-onboarding');

    await runSkillsCli(
      [
        'add',
        source,
        '--skill',
        ...MANAGED_SKILLS,
        '--agent',
        'claude-code',
        'codex',
        '--yes',
      ],
      claudeTarget,
    );

    expect(
      await readFile(
        join(
          claudeTarget,
          '.agents/skills/legreffier-explore/references/nested/example.yaml',
        ),
        'utf-8',
      ),
    ).toBe('operator_controls: {}');
    expect(
      await readFile(
        join(
          claudeTarget,
          '.agents/skills/legreffier-explore/scripts/check.sh',
        ),
        'utf-8',
      ),
    ).toContain('#!/bin/sh');

    for (const name of MANAGED_SKILLS) {
      expect(
        (
          await lstat(join(claudeTarget, '.agents', 'skills', name))
        ).isDirectory(),
      ).toBe(true);
      expect(
        await readlink(join(claudeTarget, '.claude', 'skills', name)),
      ).toBe(`../../.agents/skills/${name}`);
    }

    await runSkillsCli(
      [
        'add',
        source,
        '--skill',
        ...MANAGED_SKILLS,
        '--agent',
        'codex',
        'opencode',
        '--yes',
      ],
      nativeTarget,
    );
    for (const name of MANAGED_SKILLS) {
      expect(
        (
          await lstat(join(nativeTarget, '.agents', 'skills', name))
        ).isDirectory(),
      ).toBe(true);
    }
  }, 30_000);
});

describe('installManagedSkills', () => {
  it('maps agents and invokes the CLI exactly once', async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const runner: SkillsCliRunner = async (args, cwd) => {
      calls.push({ args, cwd });
      await writeManagedResult(cwd);
    };

    await installManagedSkills(
      tmpRoot,
      ['claude', 'codex', 'opencode', 'codex'],
      runner,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.cwd).toBe(tmpRoot);
    expect(calls[0]?.args).toContain('claude-code');
    expect(calls[0]?.args).toContain('codex');
    expect(calls[0]?.args).toContain('opencode');
    expect(calls[0]?.args.filter((arg) => arg === 'codex')).toHaveLength(1);
  });

  it('adds a universal-path anchor for a Claude-only workflow', async () => {
    const calls: string[][] = [];
    const runner: SkillsCliRunner = async (args, cwd) => {
      calls.push(args);
      await writeManagedResult(cwd);
    };

    await installManagedSkills(tmpRoot, ['claude'], runner);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('claude-code');
    expect(calls[0]).toContain('codex');
  });

  it('preserves unrelated lock entries and remains idempotent', async () => {
    const unrelated = {
      source: 'acme/skills',
      ref: 'v1',
      sourceType: 'github',
      skillPath: '.agents/skills/unrelated/SKILL.md',
      computedHash: 'a'.repeat(64),
      metadata: { owner: 'user' },
    };
    await writeFile(
      join(tmpRoot, 'skills-lock.json'),
      `${JSON.stringify({ version: 1, skills: { unrelated } }, null, 2)}\n`,
      'utf-8',
    );
    const runner: SkillsCliRunner = async (_args, cwd) => {
      const lock = JSON.parse(
        await readFile(join(cwd, 'skills-lock.json'), 'utf-8'),
      ) as { skills: Record<string, unknown> };
      await writeManagedResult(cwd, lock.skills);
    };

    await installManagedSkills(tmpRoot, ['codex'], runner);
    const first = await readFile(join(tmpRoot, 'skills-lock.json'), 'utf-8');
    await installManagedSkills(tmpRoot, ['codex'], runner);
    const second = await readFile(join(tmpRoot, 'skills-lock.json'), 'utf-8');

    expect(second).toBe(first);
    expect(JSON.parse(second).skills.unrelated).toEqual(unrelated);
  });

  it('propagates CLI failures and restores the previous lock', async () => {
    const previous = '{"version":1,"skills":{"unrelated":{"x":1}}}\n';
    await writeFile(join(tmpRoot, 'skills-lock.json'), previous, 'utf-8');
    const runner = vi
      .fn<SkillsCliRunner>()
      .mockRejectedValue(new Error('clone failed'));

    await expect(
      installManagedSkills(tmpRoot, ['codex'], runner),
    ).rejects.toThrow('clone failed');
    expect(await readFile(join(tmpRoot, 'skills-lock.json'), 'utf-8')).toBe(
      previous,
    );
  });

  it('rejects a malformed existing lock before running the CLI', async () => {
    await writeFile(join(tmpRoot, 'skills-lock.json'), '{broken', 'utf-8');
    const runner = vi.fn<SkillsCliRunner>();

    await expect(
      installManagedSkills(tmpRoot, ['codex'], runner),
    ).rejects.toThrow('Invalid skills-lock.json');
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects missing and malformed managed lock entries', async () => {
    const missingRunner: SkillsCliRunner = async (_args, cwd) => {
      await writeFile(
        join(cwd, 'skills-lock.json'),
        '{"version":1,"skills":{}}\n',
        'utf-8',
      );
    };
    await expect(
      installManagedSkills(tmpRoot, ['codex'], missingRunner),
    ).rejects.toThrow('missing entry');

    const malformedRunner: SkillsCliRunner = async (_args, cwd) => {
      await writeManagedResult(cwd, {}, (skills) => {
        skills.legreffier = { source: 'wrong' };
      });
    };
    await expect(
      installManagedSkills(tmpRoot, ['codex'], malformedRunner),
    ).rejects.toThrow('malformed managed entry');
  });

  it('rejects an installed folder that does not match its lock hash', async () => {
    const runner: SkillsCliRunner = async (_args, cwd) => {
      await writeManagedResult(cwd);
      await writeFile(
        join(cwd, '.agents/skills/legreffier/SKILL.md'),
        'tampered',
        'utf-8',
      );
    };

    await expect(
      installManagedSkills(tmpRoot, ['codex'], runner),
    ).rejects.toThrow('does not match skills-lock.json hash');
  });
});
