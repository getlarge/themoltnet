import { describe, expect, it } from 'vitest';

import { assertProjectConfigOwner } from '../src/project-config-owner.js';

describe.skipIf(process.platform === 'win32')(
  'project configuration ownership',
  () => {
    it('accepts root-owned reads but refuses replacing them as a non-root user', () => {
      expect(() =>
        assertProjectConfigOwner({ uid: 0, mode: 0o644 }, false, 501),
      ).not.toThrow();
      expect(() =>
        assertProjectConfigOwner({ uid: 0, mode: 0o644 }, true, 501),
      ).toThrow(/updates require ownership/);
      expect(() =>
        assertProjectConfigOwner({ uid: 501, mode: 0o600 }, true, 501),
      ).not.toThrow();
      expect(() =>
        assertProjectConfigOwner({ uid: 502, mode: 0o600 }, false, 501),
      ).toThrow(/owned by root/);
      expect(() =>
        assertProjectConfigOwner({ uid: 0, mode: 0o664 }, false, 501),
      ).toThrow(/not group\/world writable/);
    });
  },
);
