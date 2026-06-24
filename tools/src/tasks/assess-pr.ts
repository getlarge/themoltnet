/**
 * assess-pr.ts — synthesize an `assess_brief` task that judges an existing
 * `fulfill_brief` task using the PR-complexity rubric.
 *
 * What this is, and isn't
 * -----------------------
 * This is **not** "PR review as its own task type." It's the standard
 * `assess_brief` flow with the PR-complexity rubric inlined. The thing
 * being judged is the producer's `fulfill_brief` task — which happens
 * to have produced a PR. The PR's URL is on the producer task's output
 * (`fulfill_brief.output.pullRequestUrl`), not in this proposer's input.
 *
 * The judge agent reads the producer task's accepted attempt output by
 * calling `moltnet_get_task` and `moltnet_list_task_attempts` itself
 * (no daemon-side projection), notices a `pullRequestUrl`, and runs
 * `gh pr diff` from inside the sandbox. The PR-complexity rubric
 * drives the scoring.
 *
 * This proposer therefore needs **only the producer task's id**, not
 * the PR reference. The earlier draft of this script took `--pr` and
 * tried to bypass the producer task with a sentinel UUID, which
 * guaranteed every assessment failed at prompt-build time. Fixed.
 *
 * The producer task's `correlationId` (if set) is propagated onto the
 * assess task so both halves of the chain share one id — that's how
 * `tasks_list --correlation-id <uuid>` returns the full pair.
 *
 * Prerequisites
 * -------------
 * - `.moltnet/<agent>/` populated with `moltnet.json` and `env`
 *   (at minimum `MOLTNET_TEAM_ID` and `MOLTNET_DIARY_ID`)
 * - The target `fulfill_brief` task must exist and have at least one
 *   accepted attempt. Both are checked before POST.
 *
 * Usage
 * -----
 *   pnpm --filter @moltnet/tools task:assess-pr \
 *     --target-task <uuid> --rubric rubrics/pr-complexity-v1.json
 *   pnpm --filter @moltnet/tools task:assess-pr \
 *     --target-task <uuid> --rubric rubrics/pr-merge-gates.json --dry-run
 *
 * Flags
 * -----
 *   -t, --target-task   UUID of the fulfill_brief task to assess (required)
 *   -r, --rubric        Path to a Rubric JSON file (required). Resolved
 *                       relative to CWD. The @moltnet/tasks library ships
 *                       no default rubric — consumers author or fork one
 *                       per repo. See `rubrics/` at the repo root for
 *                       starter rubrics (pr-complexity-v1.json,
 *                       pr-merge-gates.json).
 *   -a, --agent         MoltNet agent name (default: legreffier)
 *       --dry-run       Print the synthesized Task input + skip the POST.
 *
 * Exit codes
 * ----------
 *   0 — task created (or dry-run completed)
 *   1 — bad args, missing creds, missing env vars, target task not found, API error
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';

import {
  ASSESS_BRIEF_TYPE,
  type AssessBriefInput,
  Rubric,
} from '@moltnet/tasks';
import { connect } from '@themoltnet/sdk';
import { Value } from 'typebox/value';

const { values: args } = parseArgs({
  options: {
    'target-task': { type: 'string', short: 't' },
    agent: { type: 'string', short: 'a', default: 'legreffier' },
    rubric: { type: 'string', short: 'r' },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!args['target-task']) {
  console.error(
    'Usage: tsx tools/src/tasks/assess-pr.ts --target-task <uuid> --rubric <path> [--agent <name>] [--dry-run]',
  );
  process.exit(1);
}

if (!args.rubric) {
  console.error(
    'Missing required flag: --rubric <path-to-rubric.json>\n\n' +
      'Rubrics are repo-specific — there is no default. See `rubrics/` at\n' +
      'the repo root for examples (pr-complexity-v1.json, pr-merge-gates.json),\n' +
      'or author your own. The file must conform to the @moltnet/tasks Rubric\n' +
      'schema (rubricId, version, criteria[]; weights sum to 1).',
  );
  process.exit(1);
}

const targetTaskId = args['target-task'];
const agentName = args.agent!;
const rubricArg = args.rubric;
const dryRun = args['dry-run']!;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(targetTaskId)) {
  console.error(
    `Invalid --target-task "${targetTaskId}": must be a UUID. ` +
      'Pass the id of the fulfill_brief task that produced the work you want assessed.',
  );
  process.exit(1);
}

if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
  console.error(
    `Invalid --agent "${agentName}": must match /^[a-zA-Z0-9_-]+$/`,
  );
  process.exit(1);
}

async function main() {
  const mainRepo = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const agentDir = join(mainRepo, '.moltnet', agentName);
  const envRaw = readFileSync(join(agentDir, 'env'), 'utf8');
  const envMatches = parseEnv(envRaw);
  const teamId = envMatches['MOLTNET_TEAM_ID'];
  if (!teamId) {
    throw new Error(
      `Missing MOLTNET_TEAM_ID in ${join(agentDir, 'env')}. ` +
        'Run the agent onboarding flow to populate the env file.',
    );
  }
  const diaryId = envMatches['MOLTNET_DIARY_ID'];
  if (!diaryId) {
    throw new Error(
      `Missing MOLTNET_DIARY_ID in ${join(agentDir, 'env')}. ` +
        'The Tasks API requires a diary id on every task. Set ' +
        'MOLTNET_DIARY_ID to the diary that should own this assessment.',
    );
  }

  // Resolve --rubric against the repo root, not the caller's CWD, so
  // `--rubric rubrics/pr-merge-gates.json` works the same whether the
  // operator is at the repo root, in `tools/`, or in a worktree
  // subdirectory. Absolute paths are passed through unchanged. The
  // lib ships no default rubric — consumers author or fork one per repo.
  const rubricPath = isAbsolute(rubricArg)
    ? rubricArg
    : resolve(mainRepo, rubricArg);
  let rubricJson: unknown;
  try {
    rubricJson = JSON.parse(readFileSync(rubricPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Failed to read --rubric ${rubricPath}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
  if (!Value.Check(Rubric, rubricJson)) {
    const errors = [...Value.Errors(Rubric, rubricJson)].slice(0, 5);
    throw new Error(
      `Rubric at ${rubricPath} does not match the @moltnet/tasks Rubric schema. ` +
        `First ${errors.length} validation error(s):\n` +
        errors
          .map((e) => `  - ${e.instancePath || '(root)'}: ${e.message}`)
          .join('\n'),
    );
  }
  const rubric = rubricJson;

  // Weights must sum to 1 (TypeBox enforces only per-element 0..1
  // bounds; the cross-element invariant is policy, not schema). Check
  // here so the operator gets a fast error instead of a server-side
  // rejection later — and to make the rubric author's intent explicit.
  const totalWeight = rubric.criteria.reduce(
    (acc: number, c: { weight: number }) => acc + c.weight,
    0,
  );
  if (Math.abs(totalWeight - 1) > 0.005) {
    throw new Error(
      `Rubric ${rubric.rubricId}@${rubric.version}: criterion weights ` +
        `sum to ${totalWeight.toFixed(4)}, expected 1.0 (tolerance ±0.005).`,
    );
  }

  const input: AssessBriefInput = {
    targetTaskId,
    successCriteria: {
      version: 1,
      rubric,
    },
  };

  const agent = await connect({ configDir: agentDir });

  // Sanity check the target before we POST: a non-existent task or one
  // without an accepted attempt is a configuration error the operator
  // should know about now, not after the daemon has already claimed
  // the assess task and burned a model attempt.
  const target = await agent.tasks.get(targetTaskId).catch(() => null);
  if (!target) {
    throw new Error(
      `Target task ${targetTaskId} not found via the API. ` +
        'Pass the id of an existing fulfill_brief task.',
    );
  }
  if (target.taskType !== 'fulfill_brief') {
    console.error(
      `[warn] Target task ${targetTaskId} has taskType="${target.taskType}", ` +
        'expected "fulfill_brief". Continuing anyway — the judge will ' +
        'fetch and adapt to whatever output shape it finds.',
    );
  }
  if (target.acceptedAttemptN === null) {
    throw new Error(
      `Target task ${targetTaskId} has no accepted attempt yet. ` +
        'Wait for the producer to complete before assessing.',
    );
  }

  // The reference's outputCid commits the assessment to a specific
  // attempt's output. Pull it from the producer's accepted attempt so
  // a re-run of the producer (different commit set, new outputCid)
  // produces a different judgment context, not a silently rewritten
  // one.
  const targetAttempts = await agent.tasks.listAttempts(targetTaskId);
  const acceptedAttempt = targetAttempts.find(
    (a) => a.attemptN === target.acceptedAttemptN,
  );
  if (!acceptedAttempt?.outputCid) {
    throw new Error(
      `Target task ${targetTaskId}'s accepted attempt ` +
        `(attemptN=${target.acceptedAttemptN}) has no outputCid. ` +
        'Cannot pin the assessment without a content-addressed reference.',
    );
  }

  // Inherit the producer's correlationId so `tasks_list --correlation-id`
  // returns both halves of the chain. Producer tasks created without a
  // correlationId yield null here; we pass undefined to the API, which
  // leaves the assess task's correlationId null too — also fine, just
  // means the chain isn't queryable by a shared id.
  const correlationId = target.correlationId ?? undefined;

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          taskType: ASSESS_BRIEF_TYPE,
          teamId,
          diaryId,
          correlationId,
          input,
          references: [
            {
              taskId: targetTaskId,
              outputCid: acceptedAttempt.outputCid,
              role: 'judged_work',
            },
          ],
        },
        null,
        2,
      ),
    );
    return;
  }

  const task = await agent.tasks.create(
    {
      taskType: ASSESS_BRIEF_TYPE,
      diaryId,
      correlationId,
      input: input as unknown as Record<string, unknown>,
      references: [
        {
          taskId: targetTaskId,
          outputCid: acceptedAttempt.outputCid,
          role: 'judged_work',
        },
      ],
    },
    { teamId },
  );

  if (correlationId) {
    console.error(
      `[task] inherited correlationId ${correlationId} from producer`,
    );
  } else {
    console.error(
      `[task] producer ${targetTaskId} has no correlationId; ` +
        'assess task will not share a chain id.',
    );
  }

  console.error(`[task] created ${task.id} (status=${task.status})`);
  console.log(JSON.stringify({ id: task.id, status: task.status }, null, 2));
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
