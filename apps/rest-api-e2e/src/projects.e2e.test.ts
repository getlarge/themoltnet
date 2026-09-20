import { randomUUID } from 'node:crypto';

import {
  claimTask,
  createAgentKey,
  createClient,
  createProject,
  createTask,
  createTeam,
  createTeamInvite,
  getProject,
  joinTeam,
  listProjects,
  updateProject,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createHuman, type TestAgent } from './helpers.js';
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
    const created = await createProject({
      client,
      auth,
      headers,
      body: {
        name: `project-${randomUUID()}`,
        defaultDiaryId: owner.privateDiaryId,
      },
    });
    expect(created.response.status).toBe(201);
    const projectId = created.data!.id;
    const projectPath = { projectId };
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
      expect(rejected.error).toMatchObject({
        code: 'PROJECT_MISMATCH',
        type: 'https://themolt.net/problems/project-mismatch',
      });
    }
    const archived = await updateProject({
      client,
      auth,
      headers,
      path: projectPath,
      body: { archived: true },
    });
    expect(archived.data!.archived).toBe(true);
    const hidden = await listProjects({ client, auth, headers });
    expect(hidden.data!.items.map((project) => project.id)).not.toContain(
      projectId,
    );
    const all = await listProjects({
      client,
      auth,
      headers,
      query: { includeArchived: true },
    });
    expect(all.data!.items.map((project) => project.id)).toContain(projectId);
    const newTask = await createTask({ client, auth, headers, body: taskBody });
    expect(newTask.response.status).toBe(400);
    expect(newTask.error).toMatchObject({ code: 'VALIDATION_FAILED' });
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
  it('enforces non-member and member administration boundaries end to end', async () => {
    const outsider = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });
    const team = await createTeam({
      client,
      auth: () => owner.accessToken,
      body: { name: `project-team-${randomUUID()}` },
    });
    const id = team.data!.id;
    const deniedRead = await listProjects({
      client,
      auth: () => outsider.accessToken,
      headers: { 'x-moltnet-team-id': id },
    });
    expect(deniedRead.response.status).toBe(404);
    expect(deniedRead.error).toMatchObject({ code: 'NOT_FOUND' });
    const invite = await createTeamInvite({
      client,
      auth: () => owner.accessToken,
      path: { id },
      body: { role: 'member', expiresInHours: 1 },
    });
    const joined = await joinTeam({
      client,
      auth: () => outsider.accessToken,
      body: { code: invite.data!.code },
    });
    expect(joined.response.status).toBe(200);
    const rejected = await createProject({
      client,
      auth: () => outsider.accessToken,
      headers: { 'x-moltnet-team-id': id },
      body: { name: 'member-project' },
    });
    expect(rejected.response.status).toBe(403);
    expect(rejected.error).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('infers the bound team without a header and rejects a conflicting header', async () => {
    const issued = await createAgentKey({
      client,
      auth: () => owner.accessToken,
      headers: {
        'idempotency-key': randomUUID(),
        'x-moltnet-team-id': owner.personalTeamId,
      },
      body: {
        agentId: owner.agentId,
        name: 'project-bound',
        scopes: ['team:read', 'team:manage'],
        ttlDays: 1,
      },
    });
    expect(issued.response.status).toBe(201);
    const team = await createTeam({
      client,
      auth: () => owner.accessToken,
      body: { name: `other-project-team-${randomUUID()}` },
    });
    const inferred = await createProject({
      client,
      auth: () => issued.data!.secret,
      body: { name: `inferred-${randomUUID()}` },
    });
    expect(inferred.response.status).toBe(201);
    expect(inferred.data!.teamId).toBe(owner.personalTeamId);
    const rejected = await createProject({
      client,
      auth: () => issued.data!.secret,
      headers: { 'x-moltnet-team-id': team.data!.id },
      body: { name: 'bound-project' },
    });
    expect(rejected.response.status).toBe(403);
    expect(rejected.error).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('returns the human creator attribution', async () => {
    const human = await createHuman({
      kratosPublicFrontend: harness.kratosPublicFrontend,
    });
    const humanClient = createClient({ baseUrl: harness.baseUrl });
    humanClient.interceptors.request.use((request) => {
      request.headers.set('X-Moltnet-Session-Token', human.sessionToken);
      return request;
    });
    const team = await createTeam({
      client: humanClient,
      body: { name: `human-project-team-${randomUUID()}` },
    });
    const id = team.data!.id;
    const project = await createProject({
      client: humanClient,
      headers: { 'x-moltnet-team-id': id },
      body: { name: 'Human project' },
    });
    expect(project.response.status).toBe(201);
    expect(project.data).toMatchObject({
      creatorHumanId: human.humanId,
      creatorAgentId: null,
    });
  });
});
