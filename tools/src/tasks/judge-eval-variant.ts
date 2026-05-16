/**
 * judge-eval-variant.ts — create a single `judge_eval_variant` task
 * that grades N completed `run_eval` variants against the scenario's
 * rubric.
 *
 * Usage
 * -----
 *   pnpm --filter @moltnet/tools task:judge-eval-variant \
 *     --scenario evals/legreffier/scenario-0 \
 *     --run-task-id <baseline-uuid> \
 *     --run-task-id <skilled-uuid>
 *
 * Server-side preconditions (#1101 async validator)
 * -------------------------------------------------
 *  - All `runTaskIds` resolve to tasks the caller can read.
 *  - All are `run_eval`, `status=completed`, with a non-null
 *    `acceptedAttemptN`.
 *  - All share one non-null `correlationId`.
 *  - The shared correlation is not already sealed by a previous
 *    `judge_eval_variant` create.
 *
 * Rubric source-of-truth: this script rebuilds the rubric from the
 * scenario's `criteria.json` and passes it as the judge's
 * `successCriteria`. Producer `run_eval` tasks do NOT receive that
 * rubric — the judge is the only task that should see the scoring key.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';

import {
  JUDGE_EVAL_VARIANT_TYPE,
  type JudgeEvalVariantInput,
} from '@moltnet/tasks';
import { connect, MoltNetError } from '@themoltnet/sdk';

import { buildRubricFromCriteria, readScenario } from './scenario.js';

const { values: args } = parseArgs({
  options: {
    scenario: { type: 'string', short: 's' },
    'run-task-id': { type: 'string', short: 'r', multiple: true },
    agent: { type: 'string', short: 'a', default: 'legreffier' },
    'dry-run': { type: 'boolean', default: false },
  },
});

function usage(msg?: string): never {
  if (msg) console.error(msg);
  console.error(
    'Usage: tsx tools/src/tasks/judge-eval-variant.ts \\\n' +
      '         --scenario <path> --run-task-id <uuid> --run-task-id <uuid> [...] \\\n' +
      '         [--agent <name>] [--dry-run]\n\n' +
      '       At least 2 --run-task-id values required. They must already be completed.',
  );
  process.exit(1);
}

if (!args.scenario) usage('Missing required flag: --scenario');
const runTaskIds = (args['run-task-id'] ?? []) as string[];
if (runTaskIds.length < 2) {
  usage('At least 2 --run-task-id values required (minItems on schema)');
}
if (runTaskIds.length > 10) {
  usage(
    `Too many --run-task-id values (${runTaskIds.length}). Schema caps at 10.`,
  );
}

const scenarioPath = args.scenario!;
const agentName = args.agent!;
const dryRun = args['dry-run']!;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
for (const id of runTaskIds) {
  if (!UUID_RE.test(id)) {
    usage(`Invalid --run-task-id "${id}": must be a UUID.`);
  }
}
if (new Set(runTaskIds).size !== runTaskIds.length) {
  usage('--run-task-id values must be unique');
}
if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
  usage(`Invalid --agent "${agentName}": must match /^[a-zA-Z0-9_-]+$/`);
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
        'Set the diary that should own this judge task.',
    );
  }

  const scenario = readScenario(scenarioPath, mainRepo);
  const rubric = buildRubricFromCriteria(
    scenario.criteria,
    `${scenario.scenarioId}-v1`,
  );

  const input: JudgeEvalVariantInput = {
    runTaskIds,
    successCriteria: {
      version: 1,
      rubric,
    },
  };

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          taskType: JUDGE_EVAL_VARIANT_TYPE,
          teamId,
          diaryId,
          input,
          meta: {
            scenarioPath: scenario.scenarioPath,
            scenarioId: scenario.scenarioId,
            rubricCriteriaCount: rubric.criteria.length,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  const agent = await connect({ configDir: agentDir });

  // Pre-flight: ensure each producer exists and is completed. The server
  // also enforces this, but doing the check here gives a fast, friendly
  // error before we POST a doomed judge task.
  for (const id of runTaskIds) {
    const t = await agent.tasks.get(id).catch(() => null);
    if (!t) {
      throw new Error(
        `Producer task ${id} not found via the API. ` +
          'Pass the id of an existing run_eval task.',
      );
    }
    if (t.taskType !== 'run_eval') {
      throw new Error(
        `Producer task ${id} has taskType="${t.taskType}", expected "run_eval".`,
      );
    }
    if (t.status !== 'completed' || t.acceptedAttemptN === null) {
      throw new Error(
        `Producer task ${id} is not completed with an accepted attempt ` +
          `(status=${t.status}, acceptedAttemptN=${t.acceptedAttemptN}). ` +
          'Wait for both variants to complete before judging.',
      );
    }
  }

  // Note: do NOT pass `correlationId` on a judge_eval_variant create.
  // The judge task's own correlation is null by design; the seal is
  // applied to the SHARED correlation of the resolved producers
  // (see onCreateJudgeEvalVariant in judge-eval-variant task type).
  const task = await agent.tasks.create({
    taskType: JUDGE_EVAL_VARIANT_TYPE,
    teamId,
    diaryId,
    input: input as unknown as Record<string, unknown>,
  });

  console.error(
    `[task] created ${task.id} (status=${task.status}, judging ${runTaskIds.length} variants)`,
  );
  console.log(
    JSON.stringify(
      {
        id: task.id,
        status: task.status,
        runTaskIds,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : String(err));
  if (err instanceof MoltNetError && err.validationErrors?.length) {
    console.error('[validation-errors]');
    for (const e of err.validationErrors) {
      console.error(`  - ${e.field}: ${e.message}`);
    }
  }
  process.exit(1);
});
