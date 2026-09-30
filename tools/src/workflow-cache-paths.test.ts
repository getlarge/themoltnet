import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Workflows and local composite actions. */
function workflowFiles(): string[] {
  const workflows = join(repoRoot, '.github/workflows');
  const actions = join(repoRoot, '.github/actions');
  return [
    ...readdirSync(workflows)
      .filter((file) => /\.ya?ml$/.test(file))
      .map((file) => join(workflows, file)),
    ...readdirSync(actions).map((dir) => join(actions, dir, 'action.yml')),
  ];
}

/** The entries of the value that starts at `lines[index]` (inline or `|`). */
function valueAt(
  lines: string[],
  index: number,
  indent: number,
  value: string,
) {
  if (value && value !== '|' && value !== '>') return [value];
  const entries: string[] = [];
  for (const next of lines.slice(index + 1)) {
    if (next.trim() && next.search(/\S/) <= indent) break;
    if (next.trim()) entries.push(next.trim());
  }
  return entries;
}

/**
 * Every `cache-dependency-path` (or `go-cache-dependency-path`) entry: a
 * step's `with:` value, or an action input's `default:`.
 */
function cachePaths(text: string): string[] {
  const lines = text.split('\n');
  const found: string[] = [];
  lines.forEach((line, index) => {
    const match = /^(\s*)(?:go-)?cache-dependency-path:\s*(.*)$/.exec(line);
    if (!match) return;
    const [, indent, value] = match;
    if (value) {
      found.push(...valueAt(lines, index, indent.length, value));
      return;
    }
    // An input declaration: the paths are its `default:`.
    for (let at = index + 1; at < lines.length; at += 1) {
      const next = lines[at];
      if (next.trim() && next.search(/\S/) <= indent.length) break;
      const nested = /^(\s*)default:\s*(.*)$/.exec(next);
      if (nested) {
        found.push(...valueAt(lines, at, nested[1].length, nested[2]));
      }
    }
  });
  return found;
}

describe('workflow cache keys', () => {
  it('never hash files through a ** glob', () => {
    // A `**/go.mod` cache path makes setup-go walk the whole checkout,
    // node_modules included, before it can compute the key: 12 minutes in
    // the Go CLI e2e job, which then hit its timeout. List the files.
    const offenders = workflowFiles().flatMap((file) =>
      cachePaths(readFileSync(file, 'utf8'))
        .filter((line) => line.includes('**'))
        .map((line) => `${relative(repoRoot, file)}: ${line}`),
    );

    expect(offenders).toEqual([]);
  });
});
