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
 * in Node (the grammar wasm is vendored in this package) and in the browser
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
   * vendored in this package (`wasm/`); in the browser you must pass a path/URL
   * string or the raw bytes.
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

/**
 * `executables` are the concrete programs the command runs; `escapes` are raw
 * shell-command strings passed via escape flags (e.g. `tar --to-command=…`)
 * that must be re-analyzed. Fails closed with `ok: false` for anything not
 * statically resolvable.
 */
type Resolution =
  | { ok: true; executables: string[]; escapes: string[] }
  | { ok: false; reason: string };

/** Bounds recursive wrapper unwrapping (e.g. `sudo sudo … git`). */
const MAX_WRAPPER_DEPTH = 32;

/**
 * A token in command position, tagged with whether it is a static literal
 * usable as an executable name. `name` is the decoded literal (quotes
 * stripped), or `null` for anything dynamic or escaped — an expansion,
 * substitution, concatenation, a backslash-escaped word, or an interpolated
 * string — which must fail closed rather than be classified by raw text.
 */
interface Word {
  raw: string;
  name: string | null;
}

function baseName(raw: string): string {
  const slash = raw.lastIndexOf('/');
  return slash === -1 ? raw : raw.slice(slash + 1);
}

/** Classify one AST node into a {@link Word}. */
function classifyToken(node: Node): Word {
  const raw = node.text;
  switch (node.type) {
    case 'word':
      // A backslash escapes characters (`s\h` → `sh`), changing the effective
      // name; treat such words as non-literal (fail closed) rather than decode.
      return { raw, name: raw.includes('\\') ? null : raw };
    case 'raw_string':
      // Single quotes: fully literal — no expansion or escaping inside.
      return { raw, name: raw.length >= 2 ? raw.slice(1, -1) : raw };
    case 'string': {
      // Double quotes: literal only with no interpolation children or escapes.
      const dynamic = node.namedChildren.some((c) => c) || raw.includes('\\');
      return {
        raw,
        name: dynamic ? null : raw.replace(/^"/, '').replace(/"$/, ''),
      };
    }
    default:
      // simple_expansion, expansion, command_substitution, concatenation, …
      return { raw, name: null };
  }
}

/**
 * Flatten a `command` node into command-position words `[name, ...args]`, or
 * `null` when it has no name node at all. Leading `VAR=value` env prefixes are
 * `variable_assignment` siblings (not the name) and are skipped.
 */
function commandWords(node: Node): Word[] | null {
  const nameField = node.childForFieldName('name');
  const inner = nameField?.namedChild(0);
  if (!inner) {
    return null;
  }
  const words: Word[] = [classifyToken(inner)];
  for (const child of node.namedChildren) {
    if (
      !child ||
      child.type === 'command_name' ||
      child.type === 'variable_assignment'
    ) {
      continue;
    }
    words.push(classifyToken(child));
  }
  return words;
}

type Advance =
  | { kind: 'target'; index: number }
  | { kind: 'none' }
  | { kind: 'deny'; reason: string };

/**
 * Walk a wrapper's options to the index of the command it runs. Handles
 * separate (`-u X`), attached (`-uX`), and inline (`--user=X`) value flags,
 * boolean flags (including short clusters), `--`, and env-style assignments.
 * **Fails closed** on any option in neither known set, since an unknown
 * value-taking flag could shift or swallow the real command.
 */
function advancePastWrapper(
  words: Word[],
  start: number,
  spec: WrapperSpec,
): Advance {
  const who = words[0]?.name ?? 'wrapper';
  let j = start;
  let positionals = 0;
  let afterDoubleDash = false;
  while (j < words.length) {
    const raw = words[j].raw;
    if (!afterDoubleDash && raw.length > 0) {
      if (raw === '--') {
        afterDoubleDash = true;
        j += 1;
        continue;
      }
      if (ASSIGNMENT_RE.test(raw)) {
        j += 1;
        continue;
      }
      if (raw.startsWith('--') && raw.length > 2) {
        const eq = raw.indexOf('=');
        const flag = eq === -1 ? raw : raw.slice(0, eq);
        if (spec.booleanFlags.has(flag)) {
          j += 1;
          continue;
        }
        if (spec.valueFlags.has(flag)) {
          j += eq === -1 ? 2 : 1; // `--user X` vs `--user=X`
          continue;
        }
        return {
          kind: 'deny',
          reason: `unrecognized option ${flag} for ${who}`,
        };
      }
      if (raw.startsWith('-') && raw.length > 1) {
        const head = `-${raw[1]}`; // `-u` from `-u`, `-uX`, or `-un`
        if (spec.valueFlags.has(head)) {
          j += raw.length > 2 ? 1 : 2; // `-uX` attached vs `-u X` separate
          continue;
        }
        let allBoolean = true;
        for (let k = 1; k < raw.length; k++) {
          if (!spec.booleanFlags.has(`-${raw[k]}`)) {
            allBoolean = false;
            break;
          }
        }
        if (allBoolean) {
          j += 1;
          continue;
        }
        return {
          kind: 'deny',
          reason: `unrecognized option ${raw} for ${who}`,
        };
      }
    }
    if (positionals < spec.positionalSkip) {
      positionals += 1;
      j += 1;
      continue;
    }
    return { kind: 'target', index: j };
  }
  return { kind: 'none' };
}

/**
 * Resolve `find` invocations: `find` plus the executable of every
 * `-exec`/`-execdir`/`-ok`/`-okdir` primary, each scoped to its own argument
 * span (up to the `;`/`+` terminator).
 */
function resolveFind(words: Word[], wrapperDepth: number): Resolution {
  const executables = ['find'];
  const escapes: string[] = [];
  for (let i = 1; i < words.length; i++) {
    if (!FIND_EXEC_FLAGS.has(words[i].raw)) {
      continue;
    }
    const cmd: Word[] = [];
    let k = i + 1;
    for (; k < words.length; k++) {
      const raw = words[k].raw;
      // The `;`/`+` terminator is not a named child in the grammar, so also
      // stop at the next -exec clause to keep multiple clauses independent.
      if (
        raw === ';' ||
        raw === '+' ||
        raw === '\\;' ||
        FIND_EXEC_FLAGS.has(raw)
      ) {
        break;
      }
      cmd.push(words[k]);
    }
    if (cmd.length === 0) {
      return {
        ok: false,
        reason: `find ${words[i].raw} has no command to execute`,
      };
    }
    const inner = resolveWords(cmd, wrapperDepth);
    if (!inner.ok) {
      return inner;
    }
    executables.push(...inner.executables);
    escapes.push(...inner.escapes);
    i = k - 1;
  }
  return { ok: true, executables, escapes };
}

/**
 * Resolve command-position words into concrete executables, recursing through
 * wrappers, exec-builtins, and `find -exec`. Fails closed on non-literal
 * command names.
 */
function resolveWords(words: Word[], wrapperDepth = 0): Resolution {
  const head = words[0];
  if (!head) {
    return { ok: true, executables: [], escapes: [] };
  }
  if (head.name === null) {
    return { ok: false, reason: `non-literal command name: ${head.raw}` };
  }
  const name = head.name;
  if (GLOB_RE.test(name)) {
    return { ok: false, reason: `command name contains a glob: ${name}` };
  }
  const exe = baseName(name);
  if (exe === 'eval') {
    return { ok: false, reason: 'eval executes a dynamically built command' };
  }
  if (exe === 'find') {
    return resolveFind(words, wrapperDepth);
  }
  const spec = WRAPPERS.get(exe);
  if (spec) {
    if (wrapperDepth >= MAX_WRAPPER_DEPTH) {
      return { ok: false, reason: 'wrapper nesting too deep' };
    }
    const advance = advancePastWrapper(words, 1, spec);
    if (advance.kind === 'deny') {
      return { ok: false, reason: advance.reason };
    }
    if (advance.kind === 'none') {
      return { ok: true, executables: [exe], escapes: [] };
    }
    const inner = resolveWords(words.slice(advance.index), wrapperDepth + 1);
    if (!inner.ok) {
      return inner;
    }
    return {
      ok: true,
      executables: [exe, ...inner.executables],
      escapes: inner.escapes,
    };
  }
  return {
    ok: true,
    executables: [exe],
    escapes: escapeFlagCommands(exe, words),
  };
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
 * (e.g. the `sh -c id` inside `tar --to-command='sh -c id'`), scoped to that
 * command's own argument words. Handles separate (`-e CMD`), inline
 * (`--flag=CMD`), and attached (`-eCMD`, `-oKEY=CMD`) forms. Returns `[]` for
 * binaries with no escape-flag spec.
 */
function escapeFlagCommands(exe: string, words: Word[]): string[] {
  const spec = ESCAPE_FLAG_SPECS.get(exe);
  if (!spec) {
    return [];
  }
  const commands: string[] = [];
  const push = (value: string) => {
    if (value) {
      commands.push(value);
    }
  };
  for (let i = 1; i < words.length; i++) {
    const raw = words[i].raw;

    for (const { flag, valuePrefix } of spec.inline ?? []) {
      const prefix = `${flag}=`;
      if (!raw.startsWith(prefix)) {
        continue;
      }
      let value = unquote(raw.slice(prefix.length));
      if (valuePrefix) {
        if (!value.startsWith(valuePrefix)) {
          continue;
        }
        value = value.slice(valuePrefix.length);
      }
      push(value);
    }

    for (const flag of spec.separate ?? []) {
      if (raw === flag) {
        const next = words[i + 1]?.raw;
        if (next !== undefined) {
          push(unquote(next));
        }
      } else if (
        !flag.startsWith('--') &&
        raw.length > flag.length &&
        raw.startsWith(flag)
      ) {
        push(unquote(raw.slice(flag.length))); // attached: `-eCMD`
      }
    }

    for (const { flag, keys } of spec.keyed ?? []) {
      let pair: string | undefined;
      if (raw === flag) {
        pair = words[i + 1]?.raw;
      } else if (
        !flag.startsWith('--') &&
        raw.length > flag.length &&
        raw.startsWith(flag)
      ) {
        pair = raw.slice(flag.length); // attached: `-oKEY=CMD`
      }
      if (pair === undefined) {
        continue;
      }
      const unq = unquote(pair);
      const eq = unq.indexOf('=');
      if (eq > 0 && keys.includes(unq.slice(0, eq).toLowerCase())) {
        push(unquote(unq.slice(eq + 1)));
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
  #initPromise: Promise<void> | null = null;

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
   * Load the WASM runtime and bash grammar. Idempotent and safe under
   * concurrent calls — the first call's in-flight promise (and options) win, so
   * the expensive WASM load runs exactly once; a failed load is cleared so a
   * later call can retry.
   */
  async init(options?: InitOptions): Promise<void> {
    if (this.#parser) {
      return;
    }
    if (!this.#initPromise) {
      this.#initPromise = this.#doInit(options).catch((err) => {
        this.#initPromise = null;
        throw err;
      });
    }
    return this.#initPromise;
  }

  async #doInit(options?: InitOptions): Promise<void> {
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
            reason: 'unresolvable command (no name)',
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
        }

        // Materialized escapes: re-analyze any shell command passed via an
        // escape flag (tar --to-command, rsync -e, git -c core.sshCommand, …),
        // each already scoped to its own executable's argument span.
        for (const sub of resolution.escapes) {
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
              reason: `in escape flag (${sub}): ${nested.reason}`,
              ast,
            };
          }
          tools.push(...nested.tools);
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
    const attempt: Promise<void> = shared.init(options).catch((err) => {
      // Allow a later call to retry — but only roll back if this is still the
      // current attempt (a concurrent resetAnalyzer()/init may have replaced it).
      if (sharedInit === attempt) {
        sharedInit = null;
      }
      throw err;
    });
    sharedInit = attempt;
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
