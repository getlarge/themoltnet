/**
 * judge-eval-attempt.ts — create one `judge_eval_attempt` task that grades
 * one completed `run_eval` attempt against the scenario rubric.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';

import {
  JUDGE_EVAL_ATTEMPT_TYPE,
  type JudgeEvalAttemptInput,
} from '@moltnet/tasks';
import { connect, MoltNetError } from '@themoltnet/sdk';

import { buildRubricFromCriteria, readScenario } from './scenario.js';

const { values: args } = parseArgs({
  options: {
    scenario: { type: 'string', short: 's' },
    'target-task-id': { type: 'string', short: 't' },
    agent: { type: 'string', short: 'a', default: 'legreffier' },
    'dry-run': { type: 'boolean', default: false },
  },
});

function usage(msg?: string): never {
  if (msg) console.error(msg);
  console.error(
    'Usage: tsx tools/src/tasks/judge-eval-attempt.ts \\\n' +
      '         --scenario <path> --target-task-id <uuid> \\\n' +
      '         [--agent <name>] [--dry-run]\n',
  );
  process.exit(1);
}

if (!args.scenario) usage('Missing required flag: --scenario');
if (!args['target-task-id']) usage('Missing required flag: --target-task-id');

const scenarioPath = args.scenario!;
const targetTaskId = args['target-task-id']!;
const agentName = args.agent!;
const dryRun = args['dry-run']!;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(targetTaskId)) {
  usage(`Invalid --target-task-id "${targetTaskId}": must be a UUID.`);
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

  const agent = await connect({ configDir: agentDir });
  const target = await agent.tasks.get(targetTaskId).catch(() => null);
  if (!target) {
    throw new Error(
      `Producer task ${targetTaskId} not found via the API. ` +
        'Pass the id of an existing run_eval task.',
    );
  }
  if (target.taskType !== 'run_eval') {
    throw new Error(
      `Producer task ${targetTaskId} has taskType="${target.taskType}", expected "run_eval".`,
    );
  }
  if (target.status !== 'completed' || target.acceptedAttemptN === null) {
    throw new Error(
      `Producer task ${targetTaskId} is not completed with an accepted attempt ` +
        `(status=${target.status}, acceptedAttemptN=${target.acceptedAttemptN}).`,
    );
  }
  if (!target.correlationId) {
    throw new Error(
      `Producer task ${targetTaskId} has no correlationId; cannot create judge task.`,
    );
  }

  const input: JudgeEvalAttemptInput = {
    targetTaskId,
    targetAttemptN: target.acceptedAttemptN,
    successCriteria: {
      version: 1,
      rubric,
    },
  };

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          taskType: JUDGE_EVAL_ATTEMPT_TYPE,
          teamId,
          diaryId,
          correlationId: target.correlationId,
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

  const task = await agent.tasks.create(
    {
      taskType: JUDGE_EVAL_ATTEMPT_TYPE,
      diaryId,
      correlationId: target.correlationId,
      input: input as unknown as Record<string, unknown>,
    },
    { teamId },
  );

  console.error(
    `[task] created ${task.id} (status=${task.status}, target=${targetTaskId}@${target.acceptedAttemptN})`,
  );
  console.log(
    JSON.stringify(
      {
        id: task.id,
        status: task.status,
        targetTaskId,
        targetAttemptN: target.acceptedAttemptN,
        correlationId: target.correlationId,
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
