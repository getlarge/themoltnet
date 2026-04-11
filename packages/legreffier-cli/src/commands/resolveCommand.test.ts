import { describe, expect, it } from 'vitest';

import type { CommandHelp } from './help.js';
import { resolveHelpCommand } from './resolveCommand.js';

const makeCommand = (name: string): CommandHelp => ({
  command: name,
  summary: `summary for ${name}`,
  usage: `legreffier ${name}`,
  description: `description for ${name}`,
  flags: [],
  examples: [],
});

const COMMANDS: CommandHelp[] = [
  makeCommand('init'),
  makeCommand('setup'),
  makeCommand('port'),
  makeCommand('github'),
];

describe('resolveHelpCommand', () => {
  it('returns null for an empty arg list', () => {
    expect(resolveHelpCommand([], COMMANDS)).toBeNull();
  });

  it('returns null when only --help is passed', () => {
    expect(resolveHelpCommand(['--help'], COMMANDS)).toBeNull();
    expect(resolveHelpCommand(['-h'], COMMANDS)).toBeNull();
  });

  it('matches a bare subcommand', () => {
    expect(resolveHelpCommand(['port', '--help'], COMMANDS)?.command).toBe(
      'port',
    );
  });

  it('matches when --help precedes the subcommand', () => {
    expect(resolveHelpCommand(['--help', 'port'], COMMANDS)?.command).toBe(
      'port',
    );
  });

  it('skips value of a long option that precedes the subcommand', () => {
    // This is the bug Copilot #1 flagged: naive first-positional scan
    // returns "jobi" because it skips the leading "--name" but picks up
    // its value.
    expect(
      resolveHelpCommand(['--name', 'jobi', 'port', '--help'], COMMANDS)
        ?.command,
    ).toBe('port');
  });

  it('skips value of a short option that precedes the subcommand', () => {
    expect(
      resolveHelpCommand(['-n', 'jobi', 'port', '--help'], COMMANDS)?.command,
    ).toBe('port');
  });

  it('handles --flag=value form without consuming the next arg', () => {
    expect(
      resolveHelpCommand(['--name=jobi', 'port', '--help'], COMMANDS)?.command,
    ).toBe('port');
  });

  it('handles multiple value-options before the subcommand', () => {
    expect(
      resolveHelpCommand(
        ['--name', 'jobi', '--from', '/tmp/x', 'port', '--help'],
        COMMANDS,
      )?.command,
    ).toBe('port');
  });

  it('handles --help positioned after a flag value', () => {
    expect(
      resolveHelpCommand(['--from', '/tmp/x', '-h', 'port'], COMMANDS)?.command,
    ).toBe('port');
  });

  it('returns null for an unknown positional', () => {
    expect(resolveHelpCommand(['bogus', '--help'], COMMANDS)).toBeNull();
  });

  it('returns null when only option flags are present', () => {
    expect(
      resolveHelpCommand(['--name', 'jobi', '--help'], COMMANDS),
    ).toBeNull();
  });

  it('matches the first positional, not later ones', () => {
    // `github token` — the subcommand is "github"; "token" is a second
    // positional that the caller handles separately.
    expect(
      resolveHelpCommand(['github', 'token', '--help'], COMMANDS)?.command,
    ).toBe('github');
  });
});
