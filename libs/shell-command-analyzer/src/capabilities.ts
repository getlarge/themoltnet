/**
 * Risk classification for shell executables and the specs used to "see through"
 * command wrappers (`sudo`, `env`, `timeout`, …) to the real command they run.
 *
 * Three coarse tiers. This library only *tags* risk; the consuming policy
 * engine decides what to allow, watch, or deny per tier, and may hand
 * `escapable` invocations to an LLM judge for a finer verdict.
 *
 * - `arbitrary-code`: interpreters and shells whose primary purpose is to run
 *   arbitrary code (a small, deliberate list — this is a tier judgment, not a
 *   capability fact).
 * - `escapable`: any binary present in the vendored **GTFOBins** dataset
 *   (https://gtfobins.github.io/, GPL-3.0-or-later) — real, comprehensive data
 *   on binaries that can spawn a shell, run a command, or read/write files.
 *   {@link gtfobinsFunctions} surfaces exactly which abuse functions a binary
 *   documents. See `gtfobins.generated.ts` (regenerate with
 *   `scripts/generate-gtfobins.mjs`).
 * - `unknown`: not an interpreter and not catalogued by GTFOBins. This asserts
 *   *no documented technique in our data* — NOT that the executable is safe
 *   (a project's `./deploy.sh` or an unlisted destructive tool lands here). The
 *   policy layer decides; the analyzer never claims affirmative safety.
 */

import { GTFOBINS } from './gtfobins.generated.js';

export type RiskTier = 'arbitrary-code' | 'escapable' | 'unknown';

/** A documented executable capability surfaced by the analyzer. */
export type Capability = string;

/**
 * Interpreters and shells whose *primary purpose* is to execute arbitrary code
 * supplied as an argument (`-c`), a script path, or on stdin. Statically we
 * cannot know what code they run, so a policy will almost always deny these
 * unless explicitly trusted. Checked before the GTFOBins dataset so e.g.
 * `python` is `arbitrary-code`, not merely `escapable`.
 */
export const ARBITRARY_CODE_BINARIES: ReadonlySet<string> = new Set([
  // POSIX / common shells
  'sh',
  'bash',
  'dash',
  'zsh',
  'ksh',
  'ash',
  'fish',
  'csh',
  'tcsh',
  'rbash',
  'busybox',
  // Windows / cross-platform shells
  'pwsh',
  'powershell',
  'cmd',
  // Language interpreters
  'python',
  'python2',
  'python3',
  'pypy',
  'pypy3',
  'perl',
  'ruby',
  'node',
  'nodejs',
  'deno',
  'bun',
  'php',
  'lua',
  'luajit',
  'tclsh',
  'wish',
  'Rscript',
  'groovy',
  'scala',
  'osascript',
  'jshell',
  'irb',
  'ghci',
  // Source/delegation builtins: run commands from a script we cannot see.
  'source',
  '.',
]);

/**
 * Matches versioned interpreter names such as `python3.11`, `php8.2`,
 * `node20`, `ruby3.3`. These normalize to the `arbitrary-code` tier.
 */
const VERSIONED_INTERPRETER_RE =
  /^(python|php|ruby|perl|node|nodejs|deno|bun|lua|pypy)[0-9]+(\.[0-9]+)*$/;

/**
 * The GTFOBins abuse functions a binary documents (e.g. `['file-read',
 * 'file-write', 'shell']` for `find`), or `[]` if the binary is not in the
 * dataset. This is the precise signal a policy layer or LLM judge should reason
 * about — *why* a tool is escapable, not just that it is.
 */
export function gtfobinsFunctions(name: string): readonly Capability[] {
  // `Object.hasOwn` (not `in`/index) so prototype names like `constructor` or
  // `toString` do not resolve to inherited members. Returns a defensive copy so
  // callers cannot mutate the shared dataset.
  return Object.hasOwn(GTFOBINS, name) ? [...GTFOBINS[name]] : [];
}

/** Classify a *base* executable name (directory and version suffix stripped). */
export function classifyRisk(name: string): RiskTier {
  if (
    ARBITRARY_CODE_BINARIES.has(name) ||
    VERSIONED_INTERPRETER_RE.test(name)
  ) {
    return 'arbitrary-code';
  }
  if (Object.hasOwn(GTFOBINS, name)) {
    return 'escapable';
  }
  return 'unknown';
}

/**
 * Describes how to skip a wrapper's own options and positionals to reach the
 * command it ultimately executes.
 *
 * - `valueFlags`: flags that consume a value — `-u X`, `-uX`, `--user X`, or
 *   `--user=X` — so that value is not mistaken for the wrapped command.
 * - `booleanFlags`: flags that consume nothing.
 * - `positionalSkip`: number of leading *positional* (non-flag, non-assignment)
 *   arguments the wrapper takes before the command itself (e.g. `timeout`'s
 *   DURATION, `chroot`'s NEWROOT).
 *
 * Any flag not listed in either set makes the command boundary unprovable, so
 * resolution **fails closed** rather than guessing (an unknown value-taking
 * flag would otherwise swallow or shift the real command).
 */
export interface WrapperSpec {
  valueFlags: ReadonlySet<string>;
  booleanFlags: ReadonlySet<string>;
  positionalSkip: number;
}

const spec = (
  positionalSkip: number,
  valueFlags: readonly string[] = [],
  booleanFlags: readonly string[] = [],
): WrapperSpec => ({
  positionalSkip,
  valueFlags: new Set(valueFlags),
  booleanFlags: new Set(booleanFlags),
});

/**
 * Wrappers that run another command. Resolving these lets a policy see the
 * *real* executable (`sudo git push` → `git`, not `sudo`). `command`/`builtin`
 * are shell exec-builtins that delegate to their argument command.
 */
export const WRAPPERS: ReadonlyMap<string, WrapperSpec> = new Map([
  [
    'sudo',
    spec(
      0,
      [
        '-u',
        '--user',
        '-g',
        '--group',
        '-C',
        '--close-from',
        '-h',
        '--host',
        '-p',
        '--prompt',
        '-r',
        '--role',
        '-t',
        '--type',
        '-U',
        '--other-user',
        '-R',
        '--chroot',
        '-D',
        '--chdir',
        '-T',
        '--command-timeout',
      ],
      [
        '-A',
        '--askpass',
        '-b',
        '--background',
        '-E',
        '--preserve-env',
        '-H',
        '--set-home',
        '-i',
        '--login',
        '-K',
        '--remove-timestamp',
        '-k',
        '--reset-timestamp',
        '-l',
        '--list',
        '-n',
        '--non-interactive',
        '-P',
        '--preserve-groups',
        '-S',
        '--stdin',
        '-s',
        '--shell',
        '-v',
        '--validate',
      ],
    ),
  ],
  ['doas', spec(0, ['-u', '-C'], ['-n', '-s'])],
  [
    'env',
    spec(
      0,
      ['-u', '--unset', '-C', '--chdir', '-S', '--split-string'],
      ['-i', '--ignore-environment', '-0', '--null', '-v', '--debug'],
    ),
  ],
  ['nice', spec(0, ['-n', '--adjustment'])],
  [
    'ionice',
    spec(0, ['-c', '--class', '-n', '--classdata', '-p', '--pid'], ['-t']),
  ],
  ['nohup', spec(0)],
  ['setsid', spec(0, [], ['-f', '--fork', '-w', '--wait', '-c', '--ctty'])],
  ['stdbuf', spec(0, ['-i', '--input', '-o', '--output', '-e', '--error'])],
  [
    'timeout',
    spec(
      1,
      ['-s', '--signal', '-k', '--kill-after'],
      ['--preserve-status', '--foreground', '-v', '--verbose'],
    ),
  ],
  ['chroot', spec(1, ['--userspec', '--groups'])],
  [
    'flock',
    spec(
      1,
      ['-w', '--timeout', '-E', '--conflict-exit-code'],
      [
        '-n',
        '--nonblock',
        '-s',
        '--shared',
        '-x',
        '--exclusive',
        '-u',
        '--unlock',
      ],
    ),
  ],
  [
    'xargs',
    spec(
      0,
      [
        '-I',
        '--replace',
        '-i',
        '-a',
        '--arg-file',
        '-E',
        '-e',
        '--eof',
        '-n',
        '--max-args',
        '-L',
        '--max-lines',
        '-l',
        '-P',
        '--max-procs',
        '-d',
        '--delimiter',
        '-s',
        '--max-chars',
      ],
      [
        '-0',
        '--null',
        '-p',
        '--interactive',
        '-r',
        '--no-run-if-empty',
        '-t',
        '--verbose',
        '-x',
        '--exit',
      ],
    ),
  ],
  ['exec', spec(0, ['-a'], ['-c', '-l'])],
  [
    'time',
    spec(
      0,
      ['-o', '--output', '-f', '--format'],
      ['-p', '-v', '--verbose', '-a', '--append'],
    ),
  ],
  ['unbuffer', spec(0, [], ['-p'])],
  [
    'watch',
    spec(
      0,
      ['-n', '--interval'],
      [
        '-d',
        '--differences',
        '-b',
        '--beep',
        '-g',
        '--chgexit',
        '-t',
        '--no-title',
      ],
    ),
  ],
  ['command', spec(0, [], ['-p', '-v', '-V'])],
  ['builtin', spec(0)],
]);

/** find primaries whose *next* argument is the command to execute. */
export const FIND_EXEC_FLAGS: ReadonlySet<string> = new Set([
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
]);

/**
 * Describes flags whose *value* is a shell command an otherwise-benign binary
 * will execute — the "materialized escape" of an escapable tool (`tar
 * --to-command=…`, `rsync -e …`, `git -c core.sshCommand=…`, `ssh -o
 * ProxyCommand=…`). The analyzer re-parses each such value and reports the real
 * sub-executables, so a policy can allow plain `tar -cf a.tar dir` while still
 * seeing the `sh` inside `tar --to-command='sh -c id'`.
 *
 * This covers *flag-based* escapes only. Escapes embedded in an interpreted
 * argument (`awk 'BEGIN{system(...)}'`, GNU `sed -e`) are not statically
 * resolvable and are left to the policy layer / LLM judge via the `escapable`
 * tier and the tool's GTFOBins {@link gtfobinsFunctions}.
 */
export interface EscapeFlagSpec {
  /** `--flag=CMD` — the inline value is the command (optionally after a prefix, e.g. `--checkpoint-action=exec=CMD`). */
  inline?: readonly { readonly flag: string; readonly valuePrefix?: string }[];
  /** `-e CMD` / `--rsh CMD` — the following token is the command. */
  separate?: readonly string[];
  /** `-o KEY=CMD` / `-c KEY=CMD` — the following token is `KEY=CMD`; extract CMD only for command-executing KEYs (compared case-insensitively). */
  keyed?: readonly {
    readonly flag: string;
    readonly keys: readonly string[];
  }[];
}

export const ESCAPE_FLAG_SPECS: ReadonlyMap<string, EscapeFlagSpec> = new Map([
  [
    'env',
    {
      separate: ['-S', '--split-string'],
      inline: [{ flag: '--split-string' }],
    },
  ],
  [
    'tar',
    {
      inline: [
        { flag: '--to-command' },
        { flag: '--checkpoint-action', valuePrefix: 'exec=' },
      ],
    },
  ],
  ['rsync', { separate: ['-e', '--rsh'], inline: [{ flag: '--rsh' }] }],
  ['scp', { separate: ['-S'] }],
  ['ssh', { keyed: [{ flag: '-o', keys: ['proxycommand', 'localcommand'] }] }],
  [
    'git',
    {
      keyed: [
        {
          flag: '-c',
          keys: [
            'core.sshcommand',
            'core.pager',
            'core.editor',
            'core.fsmonitor',
          ],
        },
      ],
    },
  ],
]);
