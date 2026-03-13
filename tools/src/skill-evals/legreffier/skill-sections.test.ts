import { describe, expect, it } from 'vitest';

import { splitSkillContent } from './skill-sections.js';

const MOCK_SKILL = `# LeGreffier Skill
## Agent name
Some agent name content.
## Session activation
Session steps.
## Accountable commit workflow
Step 0. Resolve credentials.
Step 1. Inspect staged changes.
## Hard gate: no ship without diary
Gate content.
## Semantic entry workflow
Semantic content.
## Episodic entry workflow
Episodic content.
## Reminders
Reminder content.
`;

describe('splitSkillContent', () => {
  it('splits at the correct boundaries', () => {
    const { preamble, commitSection, epilogue } = splitSkillContent(MOCK_SKILL);
    expect(preamble).toContain('## Session activation');
    expect(preamble).not.toContain('## Accountable commit workflow');
    expect(commitSection).toContain('## Accountable commit workflow');
    expect(commitSection).toContain('## Hard gate');
    expect(commitSection).not.toContain('## Semantic entry workflow');
    expect(epilogue).toContain('## Semantic entry workflow');
    expect(epilogue).toContain('## Reminders');
  });

  it('throws if commit heading is missing', () => {
    expect(() =>
      splitSkillContent('# No commit section\n## Semantic entry workflow\n'),
    ).toThrow('Accountable commit workflow');
  });

  it('throws if epilogue heading is missing', () => {
    expect(() =>
      splitSkillContent('# Skill\n## Accountable commit workflow\nStuff.\n'),
    ).toThrow('Semantic entry workflow');
  });
});
