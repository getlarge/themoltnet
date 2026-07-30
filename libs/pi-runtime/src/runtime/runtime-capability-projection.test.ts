import { describe, expect, it } from 'vitest';

import { projectRuntimeCapabilities } from './runtime-capability-projection.js';

describe('projectRuntimeCapabilities', () => {
  it('projects unrestricted sessions without duplicating submit tools', () => {
    expect(
      projectRuntimeCapabilities({
        visibleToolNames: ['read', 'submit_freeform'],
      }),
    ).toEqual({
      instructorPolicy: {
        enforcement: 'off',
        allowedTools: ['read'],
        allowedShellCommands: [],
        degraded: false,
      },
      unavailableTools: [],
      unavailableExecutables: [],
      droppedShellCommandCount: 0,
    });
  });

  it('preserves degradation and accounts for unavailable grants', () => {
    expect(
      projectRuntimeCapabilities({
        policy: {
          enforcement: 'enforce',
          allowedTools: new Set(['read', 'write']),
          allowedShellCommands: [{ argvPrefix: ['git', 'diff'] }],
          degraded: true,
        },
        visibleToolNames: ['read', 'submit_freeform'],
        unavailableShellCommands: [
          { argvPrefix: ['gh', 'pr', 'view'] },
          { argvPrefix: ['gh', 'issue', 'view'] },
        ],
      }),
    ).toEqual({
      instructorPolicy: {
        enforcement: 'enforce',
        allowedTools: ['read'],
        allowedShellCommands: [{ argvPrefix: ['git', 'diff'] }],
        degraded: true,
      },
      unavailableTools: ['write'],
      unavailableExecutables: ['gh'],
      droppedShellCommandCount: 2,
    });
  });
});
