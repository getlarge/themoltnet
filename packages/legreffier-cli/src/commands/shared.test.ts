import { defineCommand, runCommand } from 'citty';
import { describe, expect, it } from 'vitest';

import {
  CliValidationError,
  collectAgents,
  requireAgentName,
} from './shared.js';

describe('collectAgents', () => {
  it('returns empty array when no --agent flag present', () => {
    expect(collectAgents(['init', '--name', 'jobi'])).toEqual([]);
  });

  it('collects a single --agent value', () => {
    expect(
      collectAgents(['init', '--name', 'jobi', '--agent', 'claude']),
    ).toEqual(['claude']);
  });

  it('preserves all values when --agent is repeated', () => {
    // Regression guard: citty wraps node:util parseArgs without
    // `multiple: true`, so naive `args.agent` would only return "codex".
    // This is the whole reason collectAgents exists — walk rawArgs.
    expect(
      collectAgents([
        'init',
        '--name',
        'jobi',
        '--agent',
        'claude',
        '--agent',
        'codex',
      ]),
    ).toEqual(['claude', 'codex']);
  });

  it('supports the -a short alias', () => {
    expect(
      collectAgents(['init', '-a', 'claude', '-a', 'codex', '--name', 'jobi']),
    ).toEqual(['claude', 'codex']);
  });

  it('supports --agent=value form', () => {
    expect(collectAgents(['init', '--agent=claude', '--agent=codex'])).toEqual([
      'claude',
      'codex',
    ]);
  });

  it('supports -a=value form', () => {
    expect(collectAgents(['init', '-a=claude', '-a=codex'])).toEqual([
      'claude',
      'codex',
    ]);
  });

  it('throws CliValidationError on unsupported agent', () => {
    expect(() => collectAgents(['init', '--agent', 'bogus'])).toThrow(
      CliValidationError,
    );
    expect(() => collectAgents(['init', '--agent', 'bogus'])).toThrow(
      /Unsupported agent: bogus/,
    );
  });

  it('ignores --agent occurrences inside positional chunks', () => {
    // If a user literally puts "--agent" after `--` or as a positional,
    // our walker still picks it up because citty's rawArgs include
    // everything. That's intentional: matches the hand-rolled behavior.
    expect(collectAgents(['--', '--agent', 'claude'])).toEqual(['claude']);
  });
});

describe('citty repeated-flag behavior (regression guard for collectAgents)', () => {
  // This test locks in WHY collectAgents exists. If a future citty
  // release adds real multi-value support, this test will fail and
  // we can simplify by reading args.agent directly.
  it('citty only keeps the last value of a repeated string arg', async () => {
    let seen: unknown;
    const cmd = defineCommand({
      args: {
        agent: { type: 'string' },
      },
      run({ args }) {
        seen = args.agent;
      },
    });
    await runCommand(cmd, {
      rawArgs: ['--agent', 'claude', '--agent', 'codex'],
    });
    expect(seen).toBe('codex');
  });

  it('collectAgents recovers both values from the same rawArgs', () => {
    expect(collectAgents(['--agent', 'claude', '--agent', 'codex'])).toEqual([
      'claude',
      'codex',
    ]);
  });

  it('end-to-end: a citty command using collectAgents sees both values', async () => {
    // Exercises the full citty → rawArgs → collectAgents path the real
    // init/setup/port commands rely on. If citty ever changes how it
    // threads rawArgs into the run handler, this test catches it before
    // it ships.
    let collected: string[] | undefined;
    const cmd = defineCommand({
      args: {
        name: { type: 'string', required: true },
        agent: { type: 'string' },
      },
      run({ rawArgs }) {
        collected = collectAgents(rawArgs);
      },
    });
    await runCommand(cmd, {
      rawArgs: ['--name', 'jobi', '--agent', 'claude', '--agent', 'codex'],
    });
    expect(collected).toEqual(['claude', 'codex']);
  });
});

describe('requireAgentName', () => {
  it('returns the name when it matches the regex', () => {
    expect(requireAgentName('jobi')).toBe('jobi');
    expect(requireAgentName('agent-42')).toBe('agent-42');
  });

  it('throws CliValidationError when undefined', () => {
    expect(() => requireAgentName(undefined)).toThrow(CliValidationError);
    expect(() => requireAgentName(undefined)).toThrow(/--name is required/);
  });

  it('throws when empty string', () => {
    expect(() => requireAgentName('')).toThrow(/--name is required/);
  });

  it('throws on invalid characters', () => {
    expect(() => requireAgentName('Jobi')).toThrow(/Invalid agent name/);
    expect(() => requireAgentName('-jobi')).toThrow(/Invalid agent name/);
    expect(() => requireAgentName('jobi-')).toThrow(/Invalid agent name/);
    expect(() => requireAgentName('jobi!')).toThrow(/Invalid agent name/);
  });
});
