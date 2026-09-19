import { randomUUID } from 'node:crypto';

import {
  claimTask,
  createClient,
  createProject,
  createTask,
  getProject,
  listProjects,
  updateProject,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('project catalogue and task routing', () => {
  let harness: TestHarness;
  let owner: TestAgent;
  let client: ReturnType<typeof createClient>;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });
    owner = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });
  });
  afterAll(async () => harness?.teardown());

  it('archives a catalogue entry while preserving matching claims on existing tasks', async () => {
    const auth = () => owner.accessToken;
    const headers = { 'x-moltnet-team-id': owner.personalTeamId };
    const path = { id: owner.personalTeamId };
    const created = await createProject({
      client,
      auth,
      headers,
      path,
      body: {
        name: `project-${randomUUID()}`,
        defaultDiaryId: owner.privateDiaryId,
      },
    });
    expect(created.response.status).toBe(201);
    const projectId = created.data!.id;
    const projectPath = { ...path, projectId };
    const fetched = await getProject({
      client,
      auth,
      headers,
      path: projectPath,
    });
    expect(fetched.data).toMatchObject({
      id: projectId,
      teamId: owner.personalTeamId,
    });
    const taskBody = {
      taskType: 'freeform',
      diaryId: owner.privateDiaryId,
      projectId,
      input: { brief: 'Verify project routing.' },
    };
    const task = await createTask({ client, auth, headers, body: taskBody });
    expect(task.response.status).toBe(201);
    expect(task.data!.projectId).toBe(projectId);
    const taskPath = { id: task.data!.id };
    for (const body of [{}, { projectId: null }, { projectId: randomUUID() }]) {
      const rejected = await claimTask({
        client,
        auth,
        headers,
        path: taskPath,
        body,
      });
      expect(rejected.response.status).toBe(409);
    }
    const archived = await updateProject({
      client,
      auth,
      headers,
      path: projectPath,
      body: { archived: true },
    });
    expect(archived.data!.archived).toBe(true);
    const hidden = await listProjects({ client, auth, headers, path });
    expect(hidden.data!.items.map((project) => project.id)).not.toContain(
      projectId,
    );
    const all = await listProjects({
      client,
      auth,
      headers,
      path,
      query: { includeArchived: true },
    });
    expect(all.data!.items.map((project) => project.id)).toContain(projectId);
    const newTask = await createTask({ client, auth, headers, body: taskBody });
    expect(newTask.response.status).toBe(400);
    const claimed = await claimTask({
      client,
      auth,
      headers,
      path: taskPath,
      body: { projectId },
    });
    expect(claimed.response.status).toBe(200);
    expect(claimed.data!.task.projectId).toBe(projectId);
  });
});
