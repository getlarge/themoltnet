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
 * (`fulfill_brief.output.pullRequestUrl`), not in this imposer's input.
 *
 * The judge agent reads the producer task's accepted attempt output to
 * see what was produced (resolver in `apps/agent-daemon/src/lib/
 * resolve-prompt-extras.ts` projects it into the prompt's `target`
 * bundle), notices a `pullRequestUrl`, and runs `gh pr diff` from
 * inside the sandbox. The PR-complexity rubric drives the scoring.
 *
 * This imposer therefore needs **only the producer task's id**, not
 * the PR reference. The earlier draft of this script took `--pr` and
 * tried to bypass the producer task with a sentinel UUID, which
 * guaranteed every assessment failed at prompt-build time. Fixed.
 *
 * Prerequisites
 * -------------
 * - `.moltnet/<agent>/` populated with `moltnet.json` and `env`
 *   (at minimum `MOLTNET_TEAM_ID` and `MOLTNET_DIARY_ID`)
 * - The target `fulfill_brief` task must exist and have at least one
 *   accepted attempt. The daemon resolver will surface a clear error
 *   at run time if either is missing.
 *
 * Usage
 * -----
 *   pnpm --filter @moltnet/tools task:assess-pr --target-task <uuid>
 *   pnpm --filter @moltnet/tools task:assess-pr --target-task <uuid> --dry-run
 *
 * Flags
 * -----
 *   -t, --target-task   UUID of the fulfill_brief task to assess (required)
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
import { join } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';

import {
  ASSESS_BRIEF_TYPE,
  type AssessBriefInput,
  PR_COMPLEXITY_V1_CRITERIA,
  PR_COMPLEXITY_V1_PREAMBLE,
} from '@moltnet/tasks';
import { connect } from '@themoltnet/sdk';

const { values: args } = parseArgs({
  options: {
    'target-task': { type: 'string', short: 't' },
    agent: { type: 'string', short: 'a', default: 'legreffier' },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!args['target-task']) {
  console.error(
    'Usage: tsx tools/src/tasks/assess-pr.ts --target-task <uuid> [--agent <name>] [--dry-run]',
  );
  process.exit(1);
}

const targetTaskId = args['target-task'];
const agentName = args.agent!;
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

  const input: AssessBriefInput = {
    targetTaskId,
    criteria: [...PR_COMPLEXITY_V1_CRITERIA],
    rubricPreamble: PR_COMPLEXITY_V1_PREAMBLE,
  };

  // The daemon's resolver hydrates the judge's `target` bundle from the
  // producer task's accepted attempt output. Failing fast on a missing
  // producer would be friendlier, but checking here would couple the
  // imposer to the SDK's get/listAttempts shape — we already do that
  // below for the actual create() call. If the target doesn't exist or
  // has no accepted attempt, the daemon's resolver returns undefined,
  // the prompt builder throws `prompt_build_failed: requires target`,
  // and the operator sees a clear error on the failed attempt.
  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          taskType: ASSESS_BRIEF_TYPE,
          teamId,
          diaryId,
          input,
          references: [
            {
              taskId: targetTaskId,
              outputCid: '<resolved-from-target-task-at-create-time>',
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

  const agent = await connect({ configDir: agentDir });

  // Sanity check the target before we POST: a non-existent task or one
  // without an accepted attempt is a configuration error the operator
  // should know about now, not via a cryptic prompt_build_failed in
  // the daemon's logs ten minutes from now.
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
        'expected "fulfill_brief". Continuing anyway — the daemon resolver ' +
        'will best-effort project whatever shape the output has.',
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

  const task = await agent.tasks.create({
    taskType: ASSESS_BRIEF_TYPE,
    teamId,
    diaryId,
    input: input as unknown as Record<string, unknown>,
    references: [
      {
        taskId: targetTaskId,
        outputCid: acceptedAttempt.outputCid,
        role: 'judged_work',
      },
    ],
  });

  console.error(`[task] created ${task.id} (status=${task.status})`);
  console.log(JSON.stringify({ id: task.id, status: task.status }, null, 2));
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
