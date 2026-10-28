import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as core from '@actions/core';
import {
  collectWorkflowSpend,
  formatWorkflowSpend,
  type WorkflowSpendTask,
} from '@moltnet/tasks';
import { connect } from '@themoltnet/sdk/node';

/** Drain workers have no input task ID; use only tasks this worker claimed. */
export function claimedTaskIds(log: string): string[] {
  const ids = new Set<string>();
  for (const line of log.split('\n')) {
    try {
      const item = JSON.parse(line) as { msg?: string; taskId?: string };
      if (
        item.msg === 'agent-runtime.task_claimed' &&
        typeof item.taskId === 'string' &&
        /^[0-9a-f-]{36}$/i.test(item.taskId)
      )
        ids.add(item.taskId);
    } catch {
      /* Non-JSON daemon startup output is not a receipt. */
    }
  }
  return [...ids];
}

export async function reportActionSpend(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const ids = new Set(
    !env.SPEND_CORRELATION && env.TASK_ID ? [env.TASK_ID] : [],
  );
  if (!env.SPEND_CORRELATION && env.DAEMON_LOG && existsSync(env.DAEMON_LOG))
    for (const id of claimedTaskIds(readFileSync(env.DAEMON_LOG, 'utf8')))
      ids.add(id);
  const tasks: WorkflowSpendTask[] = [...ids].map((taskId) => ({
    taskId,
    stage: env.SPEND_STAGE || 'agent',
  }));
  if (!tasks.length && !env.SPEND_CORRELATION) return;
  // Connection failures are coverage gaps too; never turn unknown spend into zero.
  const agent = await connect({ signal: AbortSignal.timeout(30_000) }).catch(
    () => undefined,
  );
  let discoveryIncomplete = false;
  if (env.SPEND_CORRELATION) {
    if (!env.MOLTNET_TEAM_ID)
      throw new Error('Spend collection requires team context');
    try {
      if (!agent) throw new Error('unavailable');
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await agent.tasks.list(
          { correlationId: env.SPEND_CORRELATION, limit: 100, cursor },
          { teamId: env.MOLTNET_TEAM_ID },
        );
        tasks.push(
          ...page.items.map((task) => ({
            taskId: task.id,
            stage:
              (task.tags ?? [])
                .filter((tag) => /^(lane|stage|review-stage):/.test(tag))
                .join(' / ') || task.taskType,
          })),
        );
        cursor = page.nextCursor ?? undefined;
        if (cursor && seen.has(cursor)) throw new Error('repeated cursor');
        if (cursor) seen.add(cursor);
      } while (cursor);
    } catch {
      // An undiscovered tail of tasks must make overall coverage incomplete.
      discoveryIncomplete = true;
    }
  }
  if (!tasks.length && !discoveryIncomplete) return;
  const report = await collectWorkflowSpend(tasks, async (id) => {
    if (!agent) throw new Error('unavailable');
    return agent.tasks.listAttempts(id, { teamId: env.MOLTNET_TEAM_ID });
  });
  if (discoveryIncomplete) report.discoveryIncomplete = true;
  const dir = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'moltnet-spend-'));
  const json = join(dir, 'spend.json');
  const markdown = join(dir, 'spend.md');
  const summary = formatWorkflowSpend(report);
  writeFileSync(json, JSON.stringify(report), { mode: 0o600 });
  writeFileSync(markdown, summary, { mode: 0o600 });
  core.setOutput('artifact-name', `agent-spend-${dir.split('/').pop()}`);
  core.setOutput('report', json);
  core.setOutput('summary', markdown);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
}
