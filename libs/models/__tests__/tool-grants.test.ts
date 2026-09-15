import { describe, expect, it } from 'vitest';

import {
  grantsShellExecutable,
  PI_BUILTIN_STRUCTURED_TOOL_NAMES,
} from '../src/tool-grants.js';

describe('PI_BUILTIN_STRUCTURED_TOOL_NAMES', () => {
  it('lists the Pi built-in structured tools', () => {
    expect([...PI_BUILTIN_STRUCTURED_TOOL_NAMES].sort()).toEqual([
      'bash',
      'edit',
      'find',
      'grep',
      'ls',
      'read',
      'write',
    ]);
  });
});

describe('grantsShellExecutable', () => {
  it('lets a tool grant cover the same-named executable when it is not a structured tool', () => {
    // Arrange
    const toolName = 'git';

    // Act
    const result = grantsShellExecutable(toolName);

    // Assert
    expect(result).toBe(true);
  });

  it.each([...PI_BUILTIN_STRUCTURED_TOOL_NAMES])(
    'does not let the built-in structured tool %s cover a shell executable',
    (toolName) => {
      expect(grantsShellExecutable(toolName)).toBe(false);
    },
  );

  it('uses the supplied structured tool set instead of the built-in one', () => {
    // Arrange
    const structuredToolNames = new Set(['deploy']);

    // Act
    const deploy = grantsShellExecutable('deploy', structuredToolNames);
    const ls = grantsShellExecutable('ls', structuredToolNames);

    // Assert
    expect(deploy).toBe(false);
    expect(ls).toBe(true);
  });

  it('accepts a structured tool list as an array', () => {
    expect(grantsShellExecutable('deploy', ['deploy'])).toBe(false);
    expect(grantsShellExecutable('gh', ['deploy'])).toBe(true);
  });
});
