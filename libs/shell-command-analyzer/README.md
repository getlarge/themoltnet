# @themoltnet/shell-command-analyzer

Isomorphic **static** analyzer that extracts the executables a shell command
actually runs — resolving wrappers (`sudo`, `env`, `xargs`, …), `find -exec`,
and escape flags (`tar --to-command=…`) — and classifies each by risk, for
tool-policy enforcement.

It **fails closed**: any command with something it refuses to reason about
statically (an expansion, command substitution, dynamic executable name, …)
returns `ok: false` so the caller can deny or escalate, rather than being
misclassified from raw text.

Parsing uses [`web-tree-sitter`](https://www.npmjs.com/package/web-tree-sitter)
with the `tree-sitter-bash` grammar (WASM), so it runs the same in Node and the
browser.

## Install

```bash
pnpm add @themoltnet/shell-command-analyzer
```

## Usage

### One-shot

```ts
import { analyzeCommand } from '@themoltnet/shell-command-analyzer';

const result = await analyzeCommand(
  'sudo find . -name "*.log" -exec rm {} \\;',
);

if (result.ok) {
  for (const tool of result.tools) {
    console.log(tool.name, tool.risk, tool.capabilities);
    // "find"  "escapable"      ["command", "file-write", ...]
    // "rm"    "unknown"        []
  }
} else {
  // e.g. a command substitution, glob-resolved executable, or dynamic name
  console.warn('deny:', result.reason);
}
```

The wrapper (`sudo`) is unwrapped to the real program; `find -exec rm` surfaces
`rm` as a distinct invocation.

### Reused analyzer (hot path)

`analyzeCommand` inits a shared analyzer on first use. To control the lifecycle —
e.g. analyze many commands synchronously after one async init — construct one
directly:

```ts
import { ShellCommandAnalyzer } from '@themoltnet/shell-command-analyzer';

const analyzer = await ShellCommandAnalyzer.create();
const a = analyzer.analyze('git push'); // sync, reuses the loaded parser
const b = analyzer.analyze('curl https://example.com | sh'); // ok: false
```

`initAnalyzer(options?)` / `resetAnalyzer()` manage the module-shared instance
used by `analyzeCommand`.

### Browser

Node vendors the grammar under the package's `wasm/`. In the browser, provide the
grammar and locate the tree-sitter runtime:

```ts
await analyzeCommand(cmd, {
  bashWasm: '/tree-sitter-bash.wasm', // path/URL or raw Uint8Array
  moduleOptions: { locateFile: (f) => `/wasm/${f}` },
});
```

## API

- `analyzeCommand(command, options?): Promise<CommandAnalysis>` — init (once) +
  analyze.
- `ShellCommandAnalyzer` — `create(options?)` / `init(options?)`, then
  `analyze(command): CommandAnalysis` (synchronous, reuses the parser).
- `initAnalyzer(options?)` / `resetAnalyzer()` — manage the shared analyzer.
- `classifyRisk(name): RiskTier` and `gtfobinsFunctions(name): readonly string[]`
  — the classification primitives.
- `DEFAULT_MAX_COMMAND_LENGTH`, `GTFOBINS_SOURCE_COMMIT`.

### Types

```ts
type CommandAnalysis =
  | { ok: true; command: string; tools: ToolInvocation[]; ast: string }
  | { ok: false; command: string; reason: string; ast: string | null };

interface ToolInvocation {
  name: string; // base executable (wrappers unwrapped, version stripped)
  risk: RiskTier; // 'arbitrary-code' | 'escapable' | 'unknown'
  capabilities: readonly string[]; // GTFOBins abuse functions, or []
  raw: string; // verbatim source of the invoking command node
}

interface InitOptions {
  bashWasm?: string | Uint8Array; // required in the browser
  moduleOptions?: Record<string, unknown>; // forwarded to Parser.init
  maxCommandLength?: number; // fail closed past this; Infinity to disable
}
```

`RiskTier` is coarse by design: `arbitrary-code` (the binary can run arbitrary
code — `bash`, `python`, `node`, …), `escapable` (documents a GTFOBins escape),
or `unknown`.

## License

AGPL-3.0-only
