/**
 * Thin wrapper around the SDK's `agent.tasks.create()`.
 *
 * Body shape is enforced at compile time by `CreateTaskData['body']`
 * (generated from the OpenAPI spec via `agent-runtime`'s SDK), so a
 * malformed payload fails the build, not at runtime. The SDK also
 * handles client_credentials auth + token refresh; we never see a
 * bearer token here.
 *
 * The originating GitHub issue URL is embedded in the brief text the
 * agent receives; the chain id (`correlationId`) is the durable link
 * for downstream lookups. We do NOT populate `references[]` — that
 * field is for typed task-to-task pointers (e.g.
 * assess_brief→fulfill_brief, each ref carries the producer task's
 * id + outputCid + a role enum) and an issue URL has no producer
 * task.
 *
 * v1 only knows how to create `fulfill_brief` from this side.
 * Auto-creating `assess_brief` is deferred until the rubric registry
 * (#881) gives the dispatcher a clean way to pick a `criteriaCid`.
 */

import type { Task } from '@moltnet/tasks';
import type { Agent } from '@themoltnet/sdk';

export interface FulfillTaskInput {
  agent: Agent;
  teamId: string;
  diaryId: string;
  correlationId: string;
  /**
   * GitHub issue URL the @moltnet-fulfill mention came from. Inlined
   * into the brief so the agent has it as context; not stored in
   * `task.references`.
   */
  referenceUrl: string;
  title?: string;
  brief: string;
}

export async function createTask(input: FulfillTaskInput): Promise<Task> {
  const briefWithSource = input.brief.includes(input.referenceUrl)
    ? input.brief
    : `${input.brief}\n\nSource: ${input.referenceUrl}`;

  return input.agent.tasks.create({
    taskType: 'fulfill_brief',
    teamId: input.teamId,
    diaryId: input.diaryId,
    input: {
      brief: briefWithSource,
      ...(input.title ? { title: input.title } : {}),
    },
    correlationId: input.correlationId,
  });
}
