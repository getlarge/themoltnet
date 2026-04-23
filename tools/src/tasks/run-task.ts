/**
 * run-task.ts — execute a Task from a JSON fixture via the agent-runtime.
 *
 * Usage:
 *   pnpm --filter @moltnet/tools task:run --task-file demo/tasks/hello-world.json
 *   pnpm exec tsx tools/src/tasks/run-task.ts --task-file demo/tasks/hello-world.json
 *   pnpm exec tsx tools/src/tasks/run-task.ts --task-file <path> --agent legreffier \
 *     --provider openai-codex --model gpt-5.3-codex
 *
 * Template substitution (for demo-friendly chaining):
 *   Fixtures may contain `{{placeholder}}` tokens that are replaced via
 *   repeatable --set flags BEFORE JSON parsing and schema validation.
 *
 *   pnpm exec tsx tools/src/tasks/run-task.ts \
 *     --task-file demo/tasks/render-pack.template.json \
 *     --set pack_id=26004a77-bc10-43ef-a79f-c8e62faf59b1
 *
 *   Any unsubstituted `{{…}}` token after --set processing is a fatal error.
 *
 * Related
 * -------
 *   tools/src/tasks/fulfill-brief.ts — GitHub-issue shim that synthesizes a
 *                                       fulfill_brief Task and runs it.
 *   demo/tasks/*.json                — minimal Task fixtures for smoke tests.
 *   demo/tasks/*.template.json       — fixtures with `{{placeholder}}` tokens.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  AgentRuntime,
  FileTaskSource,
  StdoutReporter,
} from '@themoltnet/agent-runtime';
import {
  createPiTaskExecutor,
  type SandboxConfig,
} from '@themoltnet/pi-extension';

const { values: args } = parseArgs({
  options: {
    'task-file': { type: 'string', short: 't' },
    agent: { type: 'string', short: 'a', default: 'legreffier' },
    model: { type: 'string', short: 'm', default: 'gpt-5.3-codex' },
    provider: { type: 'string', short: 'p', default: 'openai-codex' },
    set: { type: 'string', multiple: true, short: 's' },
  },
});

if (!args['task-file']) {
  console.error(
    'Usage: tsx tools/src/tasks/run-task.ts --task-file <path> [--agent <name>] [--provider <p>] [--model <id>] [--set key=value ...]',
  );
  process.exit(1);
}

const taskFile = resolve(args['task-file']);
const agentName = args.agent!;
const modelId = args.model!;
const provider = args.provider!;
const setArgs = (args.set ?? []) as string[];

if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
  console.error(
    `Invalid --agent "${agentName}": must match /^[a-zA-Z0-9_-]+$/`,
  );
  process.exit(1);
}

function parseSetArgs(pairs: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      console.error(
        `Invalid --set "${pair}": expected key=value with a non-empty key`,
      );
      process.exit(1);
    }
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      console.error(
        `Invalid --set key "${key}": must match /^[a-zA-Z_][a-zA-Z0-9_]*$/`,
      );
      process.exit(1);
    }
    map.set(key, value);
  }
  return map;
}

/**
 * Substitute `{{key}}` tokens in raw JSON text. Any remaining `{{…}}` after
 * substitution is a fatal error so demo runs can't silently accept a
 * half-templated fixture.
 */
function substituteTemplate(raw: string, values: Map<string, string>): string {
  const applied = raw.replace(
    /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
    (_, k) => (values.has(k) ? (values.get(k) as string) : `{{${k}}}`),
  );
  const leftover = [
    ...applied.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g),
  ];
  if (leftover.length > 0) {
    const missing = [...new Set(leftover.map((m) => m[1]))].sort();
    console.error(
      `[fatal] Template has unsubstituted placeholders: ${missing
        .map((k) => `{{${k}}}`)
        .join(', ')}. Pass them via --set key=value.`,
    );
    process.exit(1);
  }
  return applied;
}

async function main() {
  const cwd = process.cwd();
  const sandboxConfig = JSON.parse(
    readFileSync(join(cwd, 'sandbox.json'), 'utf8'),
  ) as SandboxConfig;

  const mainRepo = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const agentDir = join(mainRepo, '.moltnet', agentName);

  // Resolve the fixture path the runtime will actually read. If --set flags
  // are present OR the fixture name ends in .template.json, substitute
  // placeholders in-memory and write the result to a temp file. Keeping the
  // substitution out of FileTaskSource means the library stays narrow and
  // the demo flow is pure tooling.
  const rawFixture = readFileSync(taskFile, 'utf8');
  const setValues = parseSetArgs(setArgs);
  const shouldSubstitute =
    setValues.size > 0 || taskFile.endsWith('.template.json');

  let effectiveTaskFile = taskFile;
  if (shouldSubstitute) {
    const substituted = substituteTemplate(rawFixture, setValues);
    const tmp = mkdtempSync(join(tmpdir(), 'moltnet-task-'));
    effectiveTaskFile = join(
      tmp,
      basename(taskFile).replace(/\.template\.json$/, '.json'),
    );
    writeFileSync(effectiveTaskFile, substituted, 'utf8');
  }

  console.error(`[run-task] task-file: ${taskFile}`);
  if (effectiveTaskFile !== taskFile) {
    console.error(`[run-task] substituted: ${effectiveTaskFile}`);
    if (setValues.size > 0) {
      console.error(
        `[run-task] --set applied: ${[...setValues.keys()].sort().join(', ')}`,
      );
    }
  }
  console.error(
    `[run-task] agent: ${agentName}, provider: ${provider}, model: ${modelId}`,
  );
  console.error(`[run-task] agentDir: ${agentDir}`);

  const executeTask = createPiTaskExecutor({
    agentName,
    mountPath: cwd,
    provider,
    model: modelId,
    sandboxConfig,
  });

  const runtime = new AgentRuntime({
    source: new FileTaskSource(effectiveTaskFile),
    makeReporter: () => new StdoutReporter(),
    executeTask,
  });

  const outputs = await runtime.start();
  const [output] = outputs;
  if (!output) {
    console.error('[fatal] Runtime produced no outputs');
    process.exit(1);
  }

  console.log('\n[done] TaskOutput:');
  console.log(JSON.stringify(output, null, 2));
  if (output.status !== 'completed') process.exit(1);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
