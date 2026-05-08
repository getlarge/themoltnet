/**
 * Thin wrapper around `POST /tasks`. Body shape matches
 * `CreateTaskBodySchema` in apps/rest-api/src/schemas/tasks.ts:
 *
 *   { taskType, teamId, diaryId, input, correlationId? }
 *
 * The originating GitHub issue URL is embedded in the brief text the
 * agent receives; the chain id (correlationId) is the durable link for
 * downstream lookups. We do NOT populate `references[]` — that field
 * is for typed task-to-task pointers (e.g. assess_brief→fulfill_brief,
 * each ref carries the producer task's id + outputCid + a role enum)
 * and an issue URL has no producer task.
 *
 * v1 only knows how to create `fulfill_brief` from this side. Auto-creating
 * `assess_brief` is deferred until the rubric registry (#881) gives the
 * dispatcher a clean way to pick a criteriaCid.
 */

export interface FulfillTaskInput {
  apiUrl: string;
  agentToken: string;
  teamId: string;
  diaryId: string;
  correlationId: string;
  /**
   * GitHub issue URL the @moltnet-fulfill mention came from. Inlined
   * into the brief so the agent has it as context; not stored in
   * task.references.
   */
  referenceUrl: string;
  title?: string;
  brief: string;
}

export interface CreateTaskDeps {
  fetch: typeof fetch;
}

export interface CreatedTask {
  id: string;
  correlationId?: string | null;
}

export async function createTask(
  input: FulfillTaskInput,
  deps: CreateTaskDeps,
): Promise<CreatedTask> {
  const briefWithSource = input.brief.includes(input.referenceUrl)
    ? input.brief
    : `${input.brief}\n\nSource: ${input.referenceUrl}`;

  const body = {
    taskType: 'fulfill_brief',
    teamId: input.teamId,
    diaryId: input.diaryId,
    input: {
      brief: briefWithSource,
      ...(input.title ? { title: input.title } : {}),
    },
    correlationId: input.correlationId,
  };

  const res = await deps.fetch(`${input.apiUrl}/tasks`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.agentToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '<unreadable body>');
    throw new Error(`tasks.create failed: ${res.status} ${text}`);
  }
  return (await res.json()) as CreatedTask;
}
