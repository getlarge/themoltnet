/**
 * Static shell-command analysis: given a command string, return the concrete
 * executables it runs — resolving wrappers (`sudo`, `env`, `timeout`, …) and
 * `find -exec` targets — each tagged with a coarse {@link RiskTier}, plus the
 * raw tree-sitter S-expression for downstream (e.g. LLM) inspection.
 *
 * Fails **closed**: any construct we cannot resolve statically (command or
 * process substitution, a variable/expansion command name, a globbed command
 * name, `eval`, or a syntactically invalid command) yields `{ ok: false }` so
 * the caller denies rather than guesses.
 *
 * Parsing uses `web-tree-sitter` (WASM), so the library is isomorphic: it runs
 * in Node (default grammar resolved from `tree-sitter-bash`) and in the browser
 * (pass the grammar wasm via {@link InitOptions.bashWasm}).
 */

import { Language, type Node, Parser, type Tree } from 'web-tree-sitter';

import {
  classifyRisk,
  ESCAPE_FLAG_SPECS,
  FIND_EXEC_FLAGS,
  gtfobinsFunctions,
  type RiskTier,
  WRAPPERS,
  type WrapperSpec,
} from './capabilities.js';
import { resolveDefaultBashWasm } from './default-wasm-loader.js';

/** A single executable the command invokes. */
export interface ToolInvocation {
  /** Base executable name (directory and, for interpreters, version stripped). */
  name: string;
  /** Coarse risk tier for this executable. */
  risk: RiskTier;
  /**
   * GTFOBins abuse functions this executable documents (e.g. `['file-read',
   * 'file-write', 'shell']`), or `[]` if it is not a known GTFOBins binary.
   */
  capabilities: readonly string[];
  /** Verbatim source text of the `command` node that invokes it. */
  raw: string;
}

/**
 * Result of analyzing one command string.
 *
 * `ok: true` — every executable was statically resolved. `ok: false` — the
 * command contains something we refuse to reason about statically; the caller
 * should deny (or escalate). `ast` carries the tree-sitter S-expression when a
 * parse was produced (`null` only when parsing itself failed).
 */
export type CommandAnalysis =
  | { ok: true; command: string; tools: ToolInvocation[]; ast: string }
  | { ok: false; command: string; reason: string; ast: string | null };

/** Options for {@link initAnalyzer} / {@link analyzeCommand}. */
export interface InitOptions {
  /**
   * The `tree-sitter-bash` grammar wasm. In Node this defaults to the copy
   * bundled with the `tree-sitter-bash` package; in the browser you must pass a
   * path/URL string or the raw bytes.
   */
  bashWasm?: string | Uint8Array;
  /**
   * Forwarded to `Parser.init` — e.g. `{ locateFile }` so the browser runtime
   * can find `tree-sitter.wasm`.
   */
  moduleOptions?: Record<string, unknown>;
  /**
   * Reject (fail closed) commands longer than this many characters before
   * parsing. `analyze()` is synchronous and roughly linear in input size, so an
   * unbounded command from an adversarial caller could stall the event loop.
   * Real commands are well under a kilobyte. Defaults to
   * {@link DEFAULT_MAX_COMMAND_LENGTH}; pass `Infinity` to disable.
   */
  maxCommandLength?: number;
}

/** Default cap for {@link InitOptions.maxCommandLength} (~100 KB). */
export const DEFAULT_MAX_COMMAND_LENGTH = 100_000;

const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const GLOB_RE = /[*?[\]]/;
const SUBSTITUTION_TYPES = [
  'command_substitution',
  'process_substitution',
] as const;

/** Guards against pathological nesting of escape-flag values. */
const MAX_ESCAPE_DEPTH = 3;

type Resolution =
  | { ok: true; executables: string[] }
  | { ok: false; reason: string };

function baseName(raw: string): string {
  const slash = raw.lastIndexOf('/');
  return slash === -1 ? raw : raw.slice(slash + 1);
}

/**
 * Flatten a `command` node into `[name, ...args]`, or `null` when the command
 * name is not a plain word (a variable, expansion, or substitution — i.e. a
 * dynamically-determined executable we cannot resolve statically).
 *
 * Leading `VAR=value` env prefixes are `variable_assignment` siblings in the
 * grammar (not part of the name), so they are skipped here.
 */
function commandWords(node: Node): string[] | null {
  const nameField = node.childForFieldName('name');
  const inner = nameField?.namedChild(0) ?? null;
  if (!inner || inner.type !== 'word') {
    return null;
  }
  const words = [inner.text];
  for (const child of node.namedChildren) {
    if (!child) {
      continue;
    }
    if (child.type === 'command_name' || child.type === 'variable_assignment') {
      continue;
    }
    words.push(child.text);
  }
  return words;
}

/**
 * Walk a wrapper's arguments to the index of the command it runs, or `null`
 * when it runs nothing (e.g. `env FOO=bar`, `timeout 5`). Known value-flags
 * consume their following token; `--` ends option parsing; unknown flags are
 * treated as booleans.
 */
function advancePastWrapper(
  words: string[],
  start: number,
  spec: WrapperSpec,
): number | null {
  let j = start;
  let positionals = 0;
  let afterDoubleDash = false;
  while (j < words.length) {
    const w = words[j];
    if (!afterDoubleDash) {
      if (w === '--') {
        afterDoubleDash = true;
        j += 1;
        continue;
      }
      if (ASSIGNMENT_RE.test(w)) {
        j += 1;
        continue;
      }
      if (w.length > 1 && w.startsWith('-')) {
        j += spec.valueFlags.has(w) ? 2 : 1;
        continue;
      }
    }
    if (positionals < spec.positionalSkip) {
      positionals += 1;
      j += 1;
      continue;
    }
    return j;
  }
  return null;
}

/**
 * Resolve `find` invocations: `find` itself plus the executable of every
 * `-exec`/`-execdir`/`-ok`/`-okdir` primary.
 */
function resolveFind(words: string[]): Resolution {
  const executables = ['find'];
  for (let i = 1; i < words.length; i++) {
    if (!FIND_EXEC_FLAGS.has(words[i])) {
      continue;
    }
    const cmdWords: string[] = [];
    let k = i + 1;
    for (; k < words.length; k++) {
      const w = words[k];
      if (w === ';' || w === '+' || w === '\\;') {
        break;
      }
      cmdWords.push(w);
    }
    if (cmdWords.length === 0) {
      return {
        ok: false,
        reason: `find ${words[i]} has no command to execute`,
      };
    }
    const inner = resolveWords(cmdWords);
    if (!inner.ok) {
      return inner;
    }
    executables.push(...inner.executables);
    i = k;
  }
  return { ok: true, executables };
}

/**
 * Resolve a flattened `[name, ...args]` command into concrete executables,
 * recursing through wrappers and `find -exec`.
 */
function resolveWords(words: string[]): Resolution {
  const raw = words[0];
  if (raw === undefined) {
    return { ok: true, executables: [] };
  }
  if (GLOB_RE.test(raw)) {
    return { ok: false, reason: `command name contains a glob: ${raw}` };
  }
  const exe = baseName(raw);
  if (exe === 'eval') {
    return { ok: false, reason: 'eval executes a dynamically built command' };
  }
  if (exe === 'find') {
    return resolveFind(words);
  }
  const spec = WRAPPERS.get(exe);
  if (spec) {
    const targetIndex = advancePastWrapper(words, 1, spec);
    if (targetIndex === null) {
      return { ok: true, executables: [exe] };
    }
    const inner = resolveWords(words.slice(targetIndex));
    if (!inner.ok) {
      return inner;
    }
    return { ok: true, executables: [exe, ...inner.executables] };
  }
  return { ok: true, executables: [exe] };
}

/** Strip one layer of matching surrounding single or double quotes. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const quote = value[0];
    if ((quote === "'" || quote === '"') && value[value.length - 1] === quote) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Extract the shell-command strings passed to an executable's escape flags
 * (e.g. the `sh -c id` inside `tar --to-command='sh -c id'`), for re-analysis.
 * Returns `[]` for binaries with no escape-flag spec.
 */
function escapeFlagCommands(exe: string, words: string[]): string[] {
  const spec = ESCAPE_FLAG_SPECS.get(exe);
  if (!spec) {
    return [];
  }
  const commands: string[] = [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i];

    for (const { flag, valuePrefix } of spec.inline ?? []) {
      const prefix = `${flag}=`;
      if (!w.startsWith(prefix)) {
        continue;
      }
      let value = unquote(w.slice(prefix.length));
      if (valuePrefix) {
        if (!value.startsWith(valuePrefix)) {
          continue;
        }
        value = value.slice(valuePrefix.length);
      }
      if (value) {
        commands.push(value);
      }
    }

    if (spec.separate?.includes(w)) {
      const value = words[i + 1];
      if (value !== undefined) {
        commands.push(unquote(value));
      }
    }

    for (const { flag, keys } of spec.keyed ?? []) {
      if (w !== flag) {
        continue;
      }
      const pair = unquote(words[i + 1] ?? '');
      const eq = pair.indexOf('=');
      if (eq > 0 && keys.includes(pair.slice(0, eq).toLowerCase())) {
        const value = unquote(pair.slice(eq + 1));
        if (value) {
          commands.push(value);
        }
      }
    }
  }
  return commands;
}

/**
 * A shell-command analyzer backed by a single WASM parser instance.
 *
 * Construct once per long-lived context (e.g. an agent session or the Pi
 * tool-call gate), `await init()` (or use {@link ShellCommandAnalyzer.create}),
 * then call the synchronous {@link analyze} as many times as needed — the
 * expensive WASM/grammar load happens only once.
 *
 * @example
 * const analyzer = await ShellCommandAnalyzer.create();
 * const result = analyzer.analyze('sudo git push'); // sync, reuses the parser
 */
export class ShellCommandAnalyzer {
  #parser: Parser | null = null;
  #maxCommandLength = DEFAULT_MAX_COMMAND_LENGTH;

  /** Construct and initialize in one step. */
  static async create(options?: InitOptions): Promise<ShellCommandAnalyzer> {
    const analyzer = new ShellCommandAnalyzer();
    await analyzer.init(options);
    return analyzer;
  }

  /** Whether {@link init} has completed and {@link analyze} can be called. */
  get ready(): boolean {
    return this.#parser !== null;
  }

  /**
   * Load the WASM runtime and bash grammar. Idempotent — a second call is a
   * no-op once initialized.
   */
  async init(options?: InitOptions): Promise<void> {
    if (this.#parser) {
      return;
    }
    this.#maxCommandLength =
      options?.maxCommandLength ?? DEFAULT_MAX_COMMAND_LENGTH;
    await Parser.init(options?.moduleOptions);
    const wasm = options?.bashWasm ?? resolveDefaultBashWasm();
    const language = await Language.load(wasm);
    const parser = new Parser();
    parser.setLanguage(language);
    this.#parser = parser;
  }

  /**
   * Analyze a shell command. Synchronous — {@link init} must have resolved
   * first (throws otherwise).
   */
  analyze(command: string): CommandAnalysis {
    if (!this.#parser) {
      throw new Error(
        'ShellCommandAnalyzer.init() must resolve before analyze() is called',
      );
    }
    if (command.length > this.#maxCommandLength) {
      return {
        ok: false,
        command,
        reason: `command exceeds maximum length (${this.#maxCommandLength})`,
        ast: null,
      };
    }
    return this.#extract(command, 0);
  }

  /**
   * Parse and extract executables from a command. `depth` bounds re-analysis of
   * escape-flag values (see {@link escapeFlagCommands}).
   */
  #extract(command: string, depth: number): CommandAnalysis {
    const parser = this.#parser;
    if (!parser) {
      return {
        ok: false,
        command,
        reason: 'analyzer not initialized',
        ast: null,
      };
    }

    let tree: Tree | null;
    try {
      tree = parser.parse(command);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        command,
        reason: `parse failed: ${message}`,
        ast: null,
      };
    }
    if (!tree) {
      return {
        ok: false,
        command,
        reason: 'parser returned no tree',
        ast: null,
      };
    }

    try {
      const root = tree.rootNode;
      const ast = root.toString();

      if (root.hasError) {
        return {
          ok: false,
          command,
          reason: 'shell parse error (invalid or unsupported syntax)',
          ast,
        };
      }

      for (const type of SUBSTITUTION_TYPES) {
        if (root.descendantsOfType(type).length > 0) {
          return {
            ok: false,
            command,
            reason: `contains ${type.replace('_', ' ')}`,
            ast,
          };
        }
      }

      const tools: ToolInvocation[] = [];
      for (const node of root.descendantsOfType('command')) {
        if (!node) {
          continue;
        }
        const words = commandWords(node);
        if (words === null) {
          return {
            ok: false,
            command,
            reason:
              'command name is dynamic (variable, expansion, or substitution)',
            ast,
          };
        }
        const resolution = resolveWords(words);
        if (!resolution.ok) {
          return { ok: false, command, reason: resolution.reason, ast };
        }
        const raw = node.text;
        for (const name of resolution.executables) {
          tools.push({
            name,
            risk: classifyRisk(name),
            capabilities: gtfobinsFunctions(name),
            raw,
          });

          // Materialized escapes: re-analyze any shell command passed via an
          // escape flag (tar --to-command, rsync -e, git -c core.sshCommand, …)
          // so the real sub-executable is surfaced, not just the host tool.
          for (const sub of escapeFlagCommands(name, words)) {
            if (depth >= MAX_ESCAPE_DEPTH) {
              return {
                ok: false,
                command,
                reason: 'escape-flag nesting too deep',
                ast,
              };
            }
            const nested = this.#extract(sub, depth + 1);
            if (!nested.ok) {
              return {
                ok: false,
                command,
                reason: `in ${name} escape flag (${sub}): ${nested.reason}`,
                ast,
              };
            }
            tools.push(...nested.tools);
          }
        }
      }

      if (tools.length === 0) {
        return {
          ok: false,
          command,
          reason: 'no executable command found',
          ast,
        };
      }

      return { ok: true, command, tools, ast };
    } finally {
      tree.delete();
    }
  }
}

// --- Shared-instance convenience API -------------------------------------
//
// For one-off callers (a CLI, a REST handler) that don't want to manage a
// lifecycle. Backed by a single lazily-initialized shared analyzer. Long-lived
// consumers (Pi) should construct their own ShellCommandAnalyzer instead.

let shared: ShellCommandAnalyzer | null = null;
let sharedInit: Promise<void> | null = null;

/**
 * Initialize the shared analyzer instance. Idempotent and safe to call
 * concurrently — the first call's options win. Called automatically by
 * {@link analyzeCommand}.
 */
export async function initAnalyzer(options?: InitOptions): Promise<void> {
  if (!shared) {
    shared = new ShellCommandAnalyzer();
  }
  if (!sharedInit) {
    sharedInit = shared.init(options).catch((err) => {
      // Allow a later call to retry after a failed init.
      shared = null;
      sharedInit = null;
      throw err;
    });
  }
  return sharedInit;
}

/** Drop the shared analyzer instance (primarily for tests). */
export function resetAnalyzer(): void {
  shared = null;
  sharedInit = null;
}

/**
 * Analyze a shell command using the shared analyzer, initializing it on first
 * use.
 */
export async function analyzeCommand(
  command: string,
  options?: InitOptions,
): Promise<CommandAnalysis> {
  await initAnalyzer(options);
  if (!shared) {
    return {
      ok: false,
      command,
      reason: 'analyzer not initialized',
      ast: null,
    };
  }
  return shared.analyze(command);
}
