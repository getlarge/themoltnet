/**
 * Thin wrapper around `POST /tasks`. Body shape matches
 * `CreateTaskBodySchema` in apps/rest-api/src/schemas/tasks.ts:
 *
 *   { taskType, teamId, diaryId, input, references?, correlationId? }
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
  const body = {
    taskType: 'fulfill_brief',
    teamId: input.teamId,
    diaryId: input.diaryId,
    input: {
      brief: input.brief,
      ...(input.title ? { title: input.title } : {}),
    },
    references: [{ url: input.referenceUrl, role: 'source' }],
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
