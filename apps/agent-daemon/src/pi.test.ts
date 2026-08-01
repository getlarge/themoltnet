import { GONDOLIN_BASE_EXECUTABLES } from '@themoltnet/pi-runtime';
import { describe, expect, it } from 'vitest';

import { validateRuntimeProfilePrerequisites } from './lib/runtime-profile.js';
import { defaultPiRuntimeDefinition } from './pi.js';

describe('default Pi daemon runtime', () => {
  it('advertises the commands guaranteed by the base Gondolin snapshot', () => {
    expect(defaultPiRuntimeDefinition.vm.executables).toEqual(
      GONDOLIN_BASE_EXECUTABLES,
    );
    expect(defaultPiRuntimeDefinition.vm.executables).toEqual(
      expect.arrayContaining(['git', 'gh']),
    );
    expect(() =>
      validateRuntimeProfilePrerequisites(
        {
          name: 'github-review',
          requiredEnv: [],
          requiredTools: [],
          requiredExecutables: ['git', 'gh'],
        },
        {},
        { executables: defaultPiRuntimeDefinition.vm.executables },
      ),
    ).not.toThrow();
  });
});
