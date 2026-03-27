/* eslint-disable no-console */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = join(__dirname, 'tasks');
const AGENT_IMPORT = 'agents.claude_code_moltnet:ClaudeCodeMoltNet';

const MODELS = [
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-opus-4-6',
  'anthropic/claude-haiku-4-5',
] as const;

const { values } = parseArgs({
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
  console.log(`Usage: npx tsx harbor/run.ts [options]

Options:
  -m, --model <model>       Model to use (default: anthropic/claude-sonnet-4-6)
                            Valid: ${MODELS.join(', ')}
  -t, --task <name>         Task name(s) to run (repeatable, default: all)
                            e.g. -t mcp-format-uuid-validation -t codegen-chain-go-client
  -c, --concurrency <n>     Number of concurrent trials (default: 1)
  -f, --force-build         Force Docker image rebuild
  -h, --help                Show this help

Examples:
  npx tsx harbor/run.ts
  npx tsx harbor/run.ts -t mcp-format-uuid-validation
  npx tsx harbor/run.ts -t mcp-format-uuid-validation -t codegen-chain-go-client -c 2
  npx tsx harbor/run.ts -m anthropic/claude-haiku-4-5 -f`);
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
  console.error(
    'No tasks found. Run scaffold first: npx tsx harbor/scaffold.ts',
  );
  process.exit(1);
}

// Resolve task paths
let taskPaths: string[];
if (values.task && values.task.length > 0) {
  taskPaths = [];
  for (const name of values.task) {
    const dir = join(TASKS_DIR, name);
    if (!existsSync(dir)) {
      // Try with-context variant
      const withCtx = join(TASKS_DIR, `${name}-with-context`);
      if (!existsSync(dir) && !existsSync(withCtx)) {
        console.error(`Task not found: ${name}`);
        console.error(`Available tasks:`);
        readdirSync(TASKS_DIR).forEach((t) => console.error(`  ${t}`));
        process.exit(1);
      }
    }
    taskPaths.push(dir);
  }
} else {
  taskPaths = [TASKS_DIR];
}

// Build harbor command
for (const taskPath of taskPaths) {
  const args = [
    'harbor',
    'run',
    '-p',
    taskPath,
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

  const cmd = `PYTHONPATH=${resolve(__dirname)} ${args.join(' ')}`;
  console.log(`\n> ${cmd}\n`);

  try {
    execSync(cmd, { stdio: 'inherit', cwd: resolve(__dirname, '..') });
  } catch {
    process.exit(1);
  }
}
