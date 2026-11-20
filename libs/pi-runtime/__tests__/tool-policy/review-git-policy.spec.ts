import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { ShellCommandAnalyzer } from '@themoltnet/shell-command-analyzer';
import { afterEach, beforeAll, expect, it } from 'vitest';

import { decideToolCall } from '../../src/tool-policy/gate.js';

const roots: string[] = [];
let analyzer: ShellCommandAnalyzer;
beforeAll(async () => {
  analyzer = await ShellCommandAnalyzer.create();
});
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it.each([
  'legreffier-adaptive-focused-readonly-v1',
  'legreffier-adaptive-knowledge-readonly-v1',
  'legreffier-security-review-readonly-v1',
])('keeps %s Git options immutable through the gate and real Git', (name) => {
  const policy = JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../.github/runtime-policies',
        `${name}.json`,
      ),
      'utf8',
    ),
  ) as {
    tools: string[];
    shellCommands: { argvPrefix: [string, ...string[]] }[];
  };
  const prefix = policy.shellCommands[0].argvPrefix;
  expect(prefix).toEqual([
    'git',
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--end-of-options',
  ]);
  const check = (argv: string[]) =>
    decideToolCall({
      toolName: 'bash',
      command: argv.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(' '),
      enforcement: 'enforce',
      allowedTools: new Set(policy.tools),
      allowedShellCommands: policy.shellCommands,
      analyze: (command) => analyzer.analyze(command),
    });
  const root = mkdtempSync(join(tmpdir(), 'review-git-options-'));
  roots.push(root);
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(root, 'file.txt'), 'before\n');
  git(['add', 'file.txt']);
  git(['commit', '-m', 'before']);
  const base = git(['rev-parse', 'HEAD']).trim();
  writeFileSync(join(root, 'file.txt'), 'after\n');
  git(['commit', '-am', 'after']);
  const head = git(['rev-parse', 'HEAD']).trim();
  const range = `${base}...${head}`;
  const marker = join(root, 'helper-marker');
  const helper = join(root, 'helper.sh');
  writeFileSync(
    helper,
    `#!/bin/sh\nprintf invoked >> '${marker}'\nprintf helper-output\n`,
    { mode: 0o700 },
  );
  writeFileSync(join(root, '.git/info/attributes'), 'file.txt diff=fixture\n');
  git(['config', 'diff.fixture.command', helper]);
  git(['config', 'diff.fixture.textconv', helper]);
  // Positive controls prove both configured helpers really execute without
  // the fixed flags; absence of a marker then has meaning.
  git(['diff', '--ext-diff', '--no-textconv', range]);
  expect(readFileSync(marker, 'utf8')).toContain('invoked');
  rmSync(marker);
  git(['diff', '--no-ext-diff', '--textconv', range]);
  expect(readFileSync(marker, 'utf8')).toContain('invoked');
  rmSync(marker);
  const permitted = [...prefix, range, '--', 'file.txt'];
  expect(check(permitted)).toMatchObject({ allow: true });
  const diff = git(permitted.slice(1));
  expect(diff).toContain('-before');
  expect(diff).toContain('+after');

  const sentinel = join(root, 'sentinel');
  // Positive control for Git's file-writing option with the former prefix.
  writeFileSync(sentinel, 'unchanged');
  git([...prefix.slice(1, -1), range, `--output=${sentinel}`]);
  expect(readFileSync(sentinel, 'utf8')).toContain('-before');
  const suffixes = [
    [`--output=${sentinel}`],
    ['--output', sentinel],
    [`--out=${sentinel}`],
    ['--ext-diff'],
    ['--textconv'],
    ['--no-index'],
    ['--cached'],
    ['--unified=100'],
    ['-U100'],
    ['-c', `diff.external=${helper}`],
  ];
  for (const suffix of suffixes) {
    for (const args of [
      [...suffix, range],
      [range, ...suffix],
    ]) {
      writeFileSync(sentinel, 'unchanged');
      // A prefix rule deliberately does not parse program arguments. The
      // mandatory delimiter delegates that validation to Git, which rejects
      // these options instead of applying them after the trusted flags.
      const command = [...prefix, ...args];
      expect(check(command)).toMatchObject({ allow: true });
      const result = spawnSync('git', command.slice(1), {
        cwd: root,
        encoding: 'utf8',
      });
      expect(result.status, JSON.stringify(args)).not.toBe(0);
      expect(readFileSync(sentinel, 'utf8')).toBe('unchanged');
      expect(() => readFileSync(marker)).toThrow();
    }
    // Moving a flag in front of the delimiter must fail at the policy gate.
    expect(
      check([...prefix.slice(0, -1), ...suffix, '--end-of-options', range]),
    ).toMatchObject({ allow: false });
  }
  // After --, option-looking names are literal pathspecs, never options.
  writeFileSync(sentinel, 'unchanged');
  expect(git([...prefix.slice(1), range, '--', `--output=${sentinel}`])).toBe(
    '',
  );
  expect(readFileSync(sentinel, 'utf8')).toBe('unchanged');
  expect(() => readFileSync(marker)).toThrow();
});
