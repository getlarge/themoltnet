import { describe, expect, it } from 'vitest';

import {
  isHelpFlag,
  knownTaskTypesList,
  ONCE_HELP,
  POLL_HELP,
  REGISTERED_TASK_TYPES,
  ROOT_USAGE,
} from './help.js';

describe('isHelpFlag', () => {
  it('detects --help anywhere in the argv', () => {
    expect(isHelpFlag(['--help'])).toBe(true);
    expect(isHelpFlag(['--team', 't', '--help'])).toBe(true);
    expect(isHelpFlag(['--help', '--team', 't'])).toBe(true);
  });

  it('detects -h shorthand', () => {
    expect(isHelpFlag(['-h'])).toBe(true);
    expect(isHelpFlag(['--team', 't', '-h'])).toBe(true);
  });

  it('returns false for empty argv', () => {
    expect(isHelpFlag([])).toBe(false);
  });

  it('returns false when neither flag is present', () => {
    expect(isHelpFlag(['--team', 't', '--agent', 'x'])).toBe(false);
  });
});

describe('REGISTERED_TASK_TYPES + knownTaskTypesList', () => {
  it('returns a non-empty sorted list', () => {
    expect(REGISTERED_TASK_TYPES.length).toBeGreaterThan(0);
    const sorted = [...REGISTERED_TASK_TYPES].sort();
    expect(REGISTERED_TASK_TYPES).toEqual(sorted);
  });

  it('includes the task types we know to be registered today', () => {
    expect(REGISTERED_TASK_TYPES).toContain('curate_pack');
    expect(REGISTERED_TASK_TYPES).toContain('fulfill_brief');
    expect(REGISTERED_TASK_TYPES).toContain('judge_pack');
  });

  it('joins with comma+space for the help-string formatter', () => {
    const joined = knownTaskTypesList();
    expect(joined).toContain(', ');
    for (const t of REGISTERED_TASK_TYPES) {
      expect(joined).toContain(t);
    }
  });
});

describe('help strings', () => {
  it('ROOT_USAGE lists every subcommand', () => {
    expect(ROOT_USAGE).toContain('poll');
    expect(ROOT_USAGE).toContain('once');
    expect(ROOT_USAGE).toContain('drain');
  });

  it('POLL_HELP names every required flag', () => {
    expect(POLL_HELP).toContain('--team');
    expect(POLL_HELP).toContain('--agent');
    expect(POLL_HELP).toContain('--provider');
    expect(POLL_HELP).toContain('--model');
  });

  it('ONCE_HELP names --task-id as required', () => {
    expect(ONCE_HELP).toContain('--task-id');
    expect(ONCE_HELP).toContain('Required:');
  });
});
