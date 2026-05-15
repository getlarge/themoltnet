/**
 * run-eval.ts — create a single `run_eval` task from an eval scenario
 * directory and POST it to the Tasks API.
 *
 * What this is
 * ------------
 * One imposer call per variant. Two invocations against the same
 * scenario with the same `--correlation-id` create a runnable pair:
 *
 *   pnpm --filter @moltnet/tools task:run-eval \
 *     --scenario evals/legreffier/scenario-0 \
 *     --variant baseline \
 *     --correlation-id "$CORR"
 *
 *   pnpm --filter @moltnet/tools task:run-eval \
 *     --scenario evals/legreffier/scenario-0 \
 *     --variant with-legreffier-skill \
 *     --correlation-id "$CORR" \
 *     --skill-path .claude/skills/legreffier/SKILL.md \
 *     --prompt-prefix "MARKER: prompt_prefix sanity" \
 *     --user-inline "MARKER: user_inline sanity"
 *
 * After both complete, `task:judge-eval-variant` references them.
 *
 * Why `--correlation-id` is required
 * ----------------------------------
 * Eval without a correlation id is pointless: the judge step compares
 * `run_eval` tasks grouped by `correlation_id`, and the server's async
 * validator enforces that variant tasks share one. Generating a fresh
 * UUID on each invocation would silently break the pairing. The
 * operator MUST pass `--correlation-id "$(uuidgen)"` (or reuse an
 * existing one) per #943 design.
 *
 * Why scenario.successCriteria is built from criteria.json
 * --------------------------------------------------------
 * `judge_eval_variant` requires byte-identical `successCriteria` across
 * the referenced `run_eval` tasks (enforced server-side; see
 * `libs/tasks/src/task-types/judge-eval-variant.ts` async validator).
 * Both variant invocations of this script with the same `--scenario`
 * produce the same rubric, deterministically, via
 * `scenario.buildRubricFromCriteria`.
 *
 * Out of scope
 * ------------
 * - No orchestration: this script creates one task, prints its id, and
 *   exits. Operator polls `moltnet tasks get` themselves.
 * - No results writeback: completed task attempts persist in the API.
 * - No `moltnet eval run` CLI subcommand: retired per #943 update.
 * - Will be replaced by a #1135 server-side task template once landed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';

import {
  type ContextRef,
  RUN_EVAL_TYPE,
  type RunEvalInput,
} from '@moltnet/tasks';
import { connect, MoltNetError } from '@themoltnet/sdk';

import {
  buildRubricFromCriteria,
  readScenario,
  resolveSkillBinding,
} from './scenario.js';

const { values: args } = parseArgs({
  options: {
    scenario: { type: 'string', short: 's' },
    variant: { type: 'string', short: 'v' },
    'correlation-id': { type: 'string', short: 'c' },
    'skill-path': { type: 'string', short: 'k', multiple: true },
    'prompt-prefix': { type: 'string' },
    'user-inline': { type: 'string' },
    agent: { type: 'string', short: 'a', default: 'legreffier' },
    'dry-run': { type: 'boolean', default: false },
  },
});

function usage(msg?: string): never {
  if (msg) console.error(msg);
  console.error(
    'Usage: tsx tools/src/tasks/run-eval.ts \\\n' +
      '         --scenario <path> --variant <label> --correlation-id <uuid> \\\n' +
      '         [--skill-path <path/to/SKILL.md> ...] [--prompt-prefix <text>] [--user-inline <text>] \\\n' +
      '         [--agent <name>] [--dry-run]\n\n' +
      '       --correlation-id is REQUIRED. Use `uuidgen` to mint a fresh one\n' +
      '       and reuse it for every variant in the same eval run so the judge\n' +
      '       can group them. Eval without correlation_id is pointless.',
  );
  process.exit(1);
}

if (!args.scenario) usage('Missing required flag: --scenario');
if (!args.variant) usage('Missing required flag: --variant');
if (!args['correlation-id']) usage('Missing required flag: --correlation-id');

const scenarioPath = args.scenario!;
const variantLabel = args.variant!;
const correlationId = args['correlation-id']!;
const skillPaths = (args['skill-path'] ?? []) as string[];
const promptPrefix = args['prompt-prefix'];
const userInline = args['user-inline'];
const agentName = args.agent!;
const dryRun = args['dry-run']!;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(correlationId)) {
  usage(
    `Invalid --correlation-id "${correlationId}": must be a UUID. ` +
      'Use `uuidgen` or `node -e "console.log(crypto.randomUUID())"`.',
  );
}
if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
  usage(`Invalid --agent "${agentName}": must match /^[a-zA-Z0-9_-]+$/`);
}
// `variantLabel` is also exercised by the server's pattern check via
// JudgeEvalVariantResult — same constraint we apply here so divergent
// labels can't be created on a `run_eval` that the judge later rejects.
if (variantLabel.length === 0 || variantLabel.length > 64) {
  usage(`Invalid --variant "${variantLabel}": length must be 1..64 chars.`);
}
if (/ - /.test(variantLabel)) {
  usage(
    `Invalid --variant "${variantLabel}": must not contain " - " (space-hyphen-space) — ` +
      'reserved as the delimiter in judge_eval_variant deltas keys.',
  );
}

async function main() {
  const mainRepo = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const agentDir = join(mainRepo, '.moltnet', agentName);
  const envRaw = readFileSync(join(agentDir, 'env'), 'utf8');
  const envMatches = parseEnv(envRaw);
  const teamId = envMatches['MOLTNET_TEAM_ID'];
  const diaryId = envMatches['MOLTNET_DIARY_ID'];
  if (!teamId) {
    throw new Error(
      `Missing MOLTNET_TEAM_ID in ${join(agentDir, 'env')}. ` +
        'Run the agent onboarding flow.',
    );
  }
  if (!diaryId) {
    throw new Error(
      `Missing MOLTNET_DIARY_ID in ${join(agentDir, 'env')}. ` +
        'Set the diary that should own these eval tasks.',
    );
  }

  const scenario = readScenario(scenarioPath, mainRepo);

  // Rubric drives `successCriteria` and must be byte-identical across
  // variants (#1101 judge_eval_variant async validator). Same scenario
  // dir + same arg defaults → same rubric on every invocation.
  const rubric = buildRubricFromCriteria(
    scenario.criteria,
    `${scenario.scenarioId}-v1`,
  );

  // Compose `context[]` — order is irrelevant to the runtime but we
  // emit skill bindings first (largest payloads, most expensive to
  // truncate at the 64 KiB cap), then the small prefix/suffix bindings.
  const context: ContextRef[] = [];
  for (const p of skillPaths) {
    context.push(resolveSkillBinding(p, mainRepo));
  }
  if (promptPrefix) {
    context.push({
      slug: 'prompt-prefix',
      binding: 'prompt_prefix',
      content: promptPrefix,
    });
  }
  if (userInline) {
    context.push({
      slug: 'user-inline',
      binding: 'user_inline',
      content: userInline,
    });
  }

  const input: RunEvalInput = {
    scenario: {
      prompt: scenario.taskPrompt,
    },
    variantLabel,
    execution: {
      mode: scenario.evalMode,
      workspace: scenario.evalWorkspace,
    },
    context,
    successCriteria: {
      version: 1,
      rubric,
    },
  };

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          taskType: RUN_EVAL_TYPE,
          teamId,
          diaryId,
          correlationId,
          // Truncate context.content in the dry-run dump so output stays
          // readable; the operator can see what bindings ship with what
          // sizes without scrolling through 64 KiB of skill body.
          input: {
            ...input,
            context: input.context.map((c) => ({
              ...c,
              content: `<${c.content.length} bytes>`,
            })),
            successCriteria: {
              ...input.successCriteria,
              rubric: {
                ...input.successCriteria!.rubric,
                criteria: `${input.successCriteria!.rubric!.criteria.length} criteria`,
              },
            },
          },
          meta: {
            scenarioPath: scenario.scenarioPath,
            scenarioId: scenario.scenarioId,
            evalMode: scenario.evalMode,
            evalWorkspace: scenario.evalWorkspace,
            rubricCriteriaCount: rubric.criteria.length,
            contextBindings: context.map((c) => ({
              slug: c.slug,
              binding: c.binding,
              bytes: c.content.length,
            })),
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  const agent = await connect({ configDir: agentDir });
  const task = await agent.tasks.create({
    taskType: RUN_EVAL_TYPE,
    teamId,
    diaryId,
    correlationId,
    input: input as unknown as Record<string, unknown>,
  });

  console.error(
    `[task] created ${task.id} (status=${task.status}, variant=${variantLabel}, correlation=${correlationId})`,
  );
  console.error(
    `[task] context bindings: ${context.length === 0 ? '(none)' : context.map((c) => `${c.binding}:${c.slug} (${c.content.length}B)`).join(', ')}`,
  );
  console.log(
    JSON.stringify(
      {
        id: task.id,
        status: task.status,
        correlationId,
        variantLabel,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : String(err));
  // Surface server-side field-level validation errors when present
  // (populated by the SDK from VALIDATION_FAILED ProblemDetails.errors).
  if (err instanceof MoltNetError && err.validationErrors?.length) {
    console.error('[validation-errors]');
    for (const e of err.validationErrors) {
      console.error(`  - ${e.field}: ${e.message}`);
    }
  }
  process.exit(1);
});
