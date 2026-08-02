import { readFileSync } from 'node:fs';

import type { Agent } from '@themoltnet/sdk';
import { connect } from '@themoltnet/sdk';

const ACTIVE_STATUSES = ['waiting', 'queued', 'dispatched', 'running'] as const;

interface TaskSpecIdentity {
  taskType: string;
  correlationId: string;
}

function requiredString(value: unknown, label: keyof TaskSpecIdentity): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`task spec is missing .${label}`);
  }
  return value.trim();
}

export function readTaskSpecIdentity(path: string): TaskSpecIdentity {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<
    string,
    unknown
  >;
  return {
    taskType: requiredString(parsed['taskType'], 'taskType'),
    correlationId: requiredString(parsed['correlationId'], 'correlationId'),
  };
}

export function parseSupersessionTags(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? '')
        .replaceAll('\r\n', '\n')
        .replaceAll('\r', '\n')
        .split(/[\n,]/)
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    ),
  ];
}

export async function cancelSupersededTasks(args: {
  agent: Agent;
  teamId: string;
  taskType: string;
  correlationId: string;
  selectorTags: string[];
}): Promise<string[]> {
  const tasks = await args.agent.tasks.list(
    {
      taskTypes: [args.taskType],
      statuses: [...ACTIVE_STATUSES],
      correlationId: args.correlationId,
      ...(args.selectorTags.length > 0 ? { tags: args.selectorTags } : {}),
      limit: 100,
    },
    { teamId: args.teamId },
  );
  const cancelled: string[] = [];
  for (const task of tasks.items) {
    await args.agent.tasks.cancel(task.id, {
      reason: `Superseded by a newer ${args.taskType} task in correlation ${args.correlationId}`,
    });
    cancelled.push(task.id);
  }
  return cancelled;
}

export async function runCancelSupersededFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const taskSpecPath = env['TASK_SPEC_PATH']?.trim();
  const teamId = env['MOLTNET_TEAM_ID']?.trim();
  if (!taskSpecPath) throw new Error('TASK_SPEC_PATH is required');
  if (!teamId) throw new Error('MOLTNET_TEAM_ID is required');
  const identity = readTaskSpecIdentity(taskSpecPath);
  const agent = await connect();
  return cancelSupersededTasks({
    agent,
    teamId,
    ...identity,
    selectorTags: parseSupersessionTags(env['SUPERSESSION_TAGS']),
  });
}
