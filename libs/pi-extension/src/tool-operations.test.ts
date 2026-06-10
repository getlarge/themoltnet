import { describe, expect, it } from 'vitest';

import { toGuestPath } from './tool-operations.js';
import { GUEST_TASK_SKILLS_MOUNT } from './vm-manager.js';

describe('toGuestPath', () => {
  it('accepts normalized guest workspace paths', () => {
    expect(
      toGuestPath(
        '/Users/ed/project',
        '/Users/ed/project//src/index.ts',
        '/Users/ed/project/',
      ),
    ).toBe('/Users/ed/project/src/index.ts');
  });

  it('accepts normalized task skills mount paths', () => {
    expect(
      toGuestPath(
        '/Users/ed/project',
        `${GUEST_TASK_SKILLS_MOUNT}//skill/SKILL.md`,
        '/Users/ed/project',
      ),
    ).toBe(`${GUEST_TASK_SKILLS_MOUNT}/skill/SKILL.md`);
  });

  it('maps host-relative paths into the normalized guest workspace', () => {
    expect(
      toGuestPath(
        '/Users/ed/project',
        '/Users/ed/project/src/index.ts',
        '/Users/ed/project/',
      ),
    ).toBe('/Users/ed/project/src/index.ts');
  });
});
