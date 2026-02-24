import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = resolve(
  import.meta.dirname,
  '../src/bootstrap-genesis-agents.ts',
);

describe('bootstrap --sponsor flag', () => {
  it('--help mentions --sponsor flag', () => {
    const output = execSync(`npx tsx ${script} --help`, {
      encoding: 'utf8',
    });
    expect(output).toContain('--sponsor');
  });

  it('--sponsor --dry-run prints a single agent with type=sponsor', () => {
    const output = execSync(`npx tsx ${script} --sponsor --dry-run`, {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toMatch(/sponsor/i);
    expect(parsed[0].type).toBe('sponsor');
  });

  it('--sponsor is mutually exclusive with --count', () => {
    expect(() =>
      execSync(`npx tsx ${script} --sponsor --count 2 --dry-run`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    ).toThrow();
  });

  it('--sponsor is mutually exclusive with --names', () => {
    expect(() =>
      execSync(`npx tsx ${script} --sponsor --names "Atlas" --dry-run`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    ).toThrow();
  });
});
