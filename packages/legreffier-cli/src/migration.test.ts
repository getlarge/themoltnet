import { describe, expect, it } from 'vitest';

import { getRetirementResponse, retirementMessage } from './migration.js';

describe('retirement notice', () => {
  it('routes every former responsibility to its canonical owner', () => {
    expect(retirementMessage).toContain('plugin directory');
    expect(retirementMessage).toContain('moltnet agents init');
    expect(retirementMessage).toContain('moltnet config port');
    expect(retirementMessage).not.toContain('legreffier setup');
  });

  it.each(['init', 'setup', 'port', 'github'])(
    'fails the former %s command with the migration notice',
    (command) => {
      expect(getRetirementResponse([command])).toEqual({
        exitCode: 1,
        output: retirementMessage,
        stream: 'stderr',
      });
    },
  );

  it('keeps help discoverable without reporting a command failure', () => {
    expect(getRetirementResponse(['--help'])).toEqual({
      exitCode: 0,
      output: retirementMessage,
      stream: 'stdout',
    });
  });
});
