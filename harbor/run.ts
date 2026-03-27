/* eslint-disable no-console */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = join(__dirname, 'tasks');
const ROOT = resolve(__dirname, '..');
const JOBS_DIR = join(ROOT, 'jobs');
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

// ── Helpers ──────────────────────────────────────────────────────────────────

interface TrialResult {
  task_name: string;
  verifier_result?: { rewards?: Record<string, number> };
  error?: string;
}

interface Scores {
  [key: string]: { score: number; max_score: number; evidence?: string };
}

function findLatestJobDir(): string | null {
  if (!existsSync(JOBS_DIR)) return null;
  const dirs = readdirSync(JOBS_DIR)
    .filter((d) => d.match(/^\d{4}-\d{2}-\d{2}__\d{2}-\d{2}-\d{2}$/))
    .sort()
    .reverse();
  return dirs[0] ? join(JOBS_DIR, dirs[0]) : null;
}

function printResults(jobDir: string): void {
  const resultPath = join(jobDir, 'result.json');
  if (!existsSync(resultPath)) return;

  const result = JSON.parse(readFileSync(resultPath, 'utf-8'));
  const started = result.started_at?.slice(0, 19).replace('T', ' ');
  const finished = result.finished_at?.slice(0, 19).replace('T', ' ');

  console.log(`\n${'━'.repeat(70)}`);
  console.log(`Harbor Eval Results`);
  console.log(`${'━'.repeat(70)}`);
  console.log(`Job:    ${result.id}`);
  console.log(`Time:   ${started} → ${finished}`);
  console.log(
    `Trials: ${result.n_total_trials} total, ${result.stats.n_errors} errors\n`,
  );

  // Walk trial directories for detailed scores
  const trialDirs = readdirSync(jobDir).filter((d) => {
    const p = join(jobDir, d, 'result.json');
    return existsSync(p) && d !== 'result.json';
  });

  const rows: Array<{
    task: string;
    reward: number;
    details: string;
    error?: string;
  }> = [];

  for (const dir of trialDirs) {
    const trialPath = join(jobDir, dir, 'result.json');
    const trial: TrialResult = JSON.parse(readFileSync(trialPath, 'utf-8'));
    const reward = trial.verifier_result?.rewards?.reward ?? 0;

    let details = '';
    const scoresPath = join(jobDir, dir, 'verifier', 'scores.json');
    if (existsSync(scoresPath)) {
      const scores: Scores = JSON.parse(readFileSync(scoresPath, 'utf-8'));
      details = Object.entries(scores)
        .map(([k, v]) => {
          const icon = v.score === v.max_score ? '✓' : '✗';
          return `${icon} ${v.score}/${v.max_score} ${k}`;
        })
        .join('\n         ');
    }

    rows.push({
      task: trial.task_name,
      reward,
      details,
      error: trial.error,
    });
  }

  rows.sort((a, b) => a.task.localeCompare(b.task));

  for (const row of rows) {
    const pct = (row.reward * 100).toFixed(0);
    const bar = '█'.repeat(Math.round(row.reward * 20)).padEnd(20, '░');
    console.log(`  ${row.task}`);
    if (row.error) {
      console.log(`    ${bar} ERROR: ${row.error}`);
    } else {
      console.log(`    ${bar} ${pct}%`);
      if (row.details) {
        console.log(`         ${row.details}`);
      }
    }
    console.log();
  }

  // Summary table for paired results
  const tasks = new Map<string, { without?: number; with?: number }>();
  for (const row of rows) {
    const base = row.task.replace(/-with-context$/, '');
    const entry = tasks.get(base) ?? {};
    if (row.task.endsWith('-with-context')) {
      entry.with = row.reward;
    } else {
      entry.without = row.reward;
    }
    tasks.set(base, entry);
  }

  const paired = [...tasks.entries()].filter(
    ([, v]) => v.without !== undefined && v.with !== undefined,
  );
  if (paired.length > 0) {
    console.log(`${'─'.repeat(70)}`);
    console.log(`Context Impact Summary\n`);
    console.log(`  ${'Task'.padEnd(45)} Without  With  Delta`);
    console.log(`  ${'─'.repeat(65)}`);
    for (const [name, v] of paired) {
      const w = ((v.without ?? 0) * 100).toFixed(0).padStart(4);
      const c = ((v.with ?? 0) * 100).toFixed(0).padStart(4);
      const delta = (((v.with ?? 0) - (v.without ?? 0)) * 100).toFixed(0);
      const sign = +delta > 0 ? '+' : '';
      console.log(`  ${name.padEnd(45)} ${w}%  ${c}%  ${sign}${delta}pts`);
    }
  }

  console.log(`\n${'━'.repeat(70)}`);
  console.log(`Results: ${jobDir}`);
}

// ── Run ──────────────────────────────────────────────────────────────────────

for (const taskPath of taskPaths) {
  const taskName = taskPath.split('/').pop();
  const args = [
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

  console.log(`Running: ${model} | ${taskName}\n`);

  try {
    execFileSync('harbor', args, {
      stdio: ['inherit', 'inherit', 'pipe'],
      cwd: ROOT,
      env: { ...process.env, PYTHONPATH: resolve(__dirname) },
    });
  } catch {
    // Harbor exits non-zero on trial errors — we still want to show results
  }
}

// Print results from the latest job
const latestJob = findLatestJobDir();
if (latestJob) {
  printResults(latestJob);
}
