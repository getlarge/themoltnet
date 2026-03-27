/* eslint-disable no-console */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = join(__dirname, 'tasks');
const ROOT = resolve(__dirname, '..');
const AGENT_IMPORT = 'agents.claude_code_moltnet:ClaudeCodeMoltNet';

const MODELS = [
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-opus-4-6',
  'anthropic/claude-haiku-4-5',
] as const;

// Strip leading '--' injected by npm run
const rawArgs = process.argv.slice(2).filter((a) => a !== '--');

const { values } = parseArgs({
  args: rawArgs,
  options: {
    model: {
      type: 'string',
      short: 'm',
      default: 'anthropic/claude-sonnet-4-6',
    },
    task: { type: 'string', short: 't', multiple: true },
    concurrency: { type: 'string', short: 'c', default: '1' },
    'force-build': { type: 'boolean', short: 'f', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`Usage: pnpm eval:run [options]

Options:
  -m, --model <model>       Model to use (default: anthropic/claude-sonnet-4-6)
                            Valid: ${MODELS.join(', ')}
  -t, --task <name>         Task name(s) to run (repeatable, default: all)
                            e.g. -t mcp-format-uuid-validation -t codegen-chain-go-client
  -c, --concurrency <n>     Number of concurrent trials (default: 1)
  -f, --force-build         Force Docker image rebuild
  -h, --help                Show this help

Examples:
  pnpm eval:run
  pnpm eval:run -t mcp-format-uuid-validation
  pnpm eval:run -t mcp-format-uuid-validation -t codegen-chain-go-client -c 2
  pnpm eval:run -m anthropic/claude-haiku-4-5 -f`);
  process.exit(0);
}

// Validate model
const model = values.model!;
if (!MODELS.includes(model as (typeof MODELS)[number])) {
  console.error(`Invalid model: ${model}`);
  console.error(`Valid models: ${MODELS.join(', ')}`);
  process.exit(1);
}

// Validate concurrency
const concurrency = parseInt(values.concurrency!, 10);
if (isNaN(concurrency) || concurrency < 1) {
  console.error(`Invalid concurrency: ${values.concurrency}`);
  process.exit(1);
}

// Validate tasks dir exists
if (!existsSync(TASKS_DIR)) {
  console.error('No tasks found. Run scaffold first: pnpm eval:scaffold');
  process.exit(1);
}

// Resolve task paths
let taskPaths: string[];
if (values.task && values.task.length > 0) {
  taskPaths = [];
  for (const name of values.task) {
    const dir = join(TASKS_DIR, name);
    const withCtx = join(TASKS_DIR, `${name}-with-context`);
    if (existsSync(dir)) {
      taskPaths.push(dir);
    } else if (existsSync(withCtx)) {
      taskPaths.push(withCtx);
    } else {
      console.error(`Task not found: ${name}`);
      console.error(`Available tasks:`);
      readdirSync(TASKS_DIR).forEach((t) => console.error(`  ${t}`));
      process.exit(1);
    }
  }
} else {
  taskPaths = [TASKS_DIR];
}

// ── Run ──────────────────────────────────────────────────────────────────────

// If multiple specific tasks, symlink them into a temp dir so Harbor
// runs them as a single job (one result.json with all trials).
let runPath: string;
let tempDir: string | null = null;

if (taskPaths.length === 1) {
  runPath = taskPaths[0];
} else {
  tempDir = mkdtempSync(join(tmpdir(), 'harbor-eval-'));
  for (const tp of taskPaths) {
    const name = tp.split('/').pop()!;
    symlinkSync(tp, join(tempDir, name));
  }
  runPath = tempDir;
}

const args = [
  'run',
  '-p',
  runPath,
  '--agent-import-path',
  AGENT_IMPORT,
  '--model',
  model,
  '--n-concurrent',
  String(concurrency),
  '-y',
];

if (values['force-build']) {
  args.push('--force-build');
}

try {
  execFileSync('harbor', args, {
    stdio: 'inherit',
    cwd: ROOT,
    env: { ...process.env, PYTHONPATH: resolve(__dirname) },
  });
} catch {
  // Harbor exits non-zero on trial errors
} finally {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
}
