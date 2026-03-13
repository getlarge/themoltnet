import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import { SkillEvalTaskSchema } from './skill-types.js';

describe('SkillEvalTaskSchema', () => {
  it('validates a minimal skill eval task', () => {
    const task = {
      id: 'legreffier-commit-feat',
      baseCommit: '6486435',
      taskPrompt: 'Commit using legreffier.',
      patchFiles: ['patch.diff'],
      skillPath: '.claude/skills/legreffier/SKILL.md',
    };
    expect(Value.Check(SkillEvalTaskSchema, task)).toBe(true);
  });

  it('rejects task with empty patchFiles', () => {
    const task = {
      id: 'bad',
      baseCommit: '6486435',
      taskPrompt: 'Commit.',
      patchFiles: [],
      skillPath: '.claude/skills/legreffier/SKILL.md',
    };
    expect(Value.Check(SkillEvalTaskSchema, task)).toBe(false);
  });

  it('accepts optional env and expected fields', () => {
    const task = {
      id: 'with-extras',
      baseCommit: '6486435',
      taskPrompt: 'Commit.',
      patchFiles: ['p.diff'],
      skillPath: '.claude/skills/legreffier/SKILL.md',
      env: { FOO: 'bar' },
      expected: { riskLevel: 'medium' },
    };
    expect(Value.Check(SkillEvalTaskSchema, task)).toBe(true);
  });
});
