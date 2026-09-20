import { DiaryServiceError } from '@moltnet/diary-service';
import type { FastifyInstance } from 'fastify';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  createMockServices,
  createTestApp,
  HUMAN_AUTH_CONTEXT,
  KEY_AUTH_CONTEXT,
  type MockServices,
  resetMockServices,
  TEST_BEARER_TOKEN,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const TEAM = 'aa0e8400-e29b-41d4-a716-446655440011';
const ID = '990e8400-e29b-41d4-a716-446655440010';
const DIARY = 'bb0e8400-e29b-41d4-a716-446655440011';
const headers = {
  authorization: `Bearer ${TEST_BEARER_TOKEN}`,
  'x-moltnet-team-id': TEAM,
};
const project = {
  id: ID,
  teamId: TEAM,
  creatorAgentId: VALID_AUTH_CONTEXT.agentId,
  creatorHumanId: null,
  name: 'Research',
  description: null,
  defaultDiaryId: null,
  archived: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('shared team projects', () => {
  let app: FastifyInstance;
  let mocks: MockServices;
  let authContext = VALID_AUTH_CONTEXT;
  const repository = {
    create: vi.fn(),
    findById: vi.fn(),
    listByTeamId: vi.fn(),
    update: vi.fn(),
  };
  beforeAll(async () => {
    mocks = createMockServices();
    Object.assign(mocks, { projectRepository: repository });
    app = await createTestApp(
      mocks,
      null,
      undefined,
      undefined,
      () => authContext,
    );
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    authContext = VALID_AUTH_CONTEXT;
    resetMockServices(mocks);
    Object.values(repository).forEach((mock) => mock.mockReset());
    repository.create.mockResolvedValue(project);
    repository.findById.mockResolvedValue(project);
    repository.listByTeamId.mockResolvedValue([project]);
    repository.update.mockResolvedValue(project);
    mocks.permissionChecker.canWriteTeam.mockResolvedValue(true);
    mocks.permissionChecker.canManageTeamMembers.mockResolvedValue(true);
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.teamRepository.findById.mockResolvedValue({ id: TEAM });
  });
  it.each(['GET', 'POST', 'PATCH'] as const)(
    'requires a team selection for unbound %s requests',
    async (method) => {
      const response = await app.inject({
        method,
        url: method === 'PATCH' ? `/projects/${ID}` : '/projects',
        headers: { authorization: headers.authorization },
        ...(method === 'GET' ? {} : { payload: { name: 'Research' } }),
      });
      expect(response.statusCode).toBe(400);
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
      expect(repository.listByTeamId).not.toHaveBeenCalled();
    },
  );
  it('does not expose the old team-prefixed routes', async () => {
    expect(
      (await app.inject({ url: `/teams/${TEAM}/projects`, headers }))
        .statusCode,
    ).toBe(404);
  });
  it('returns bounded pages and an explicit next offset', async () => {
    repository.listByTeamId.mockResolvedValue([
      project,
      { ...project, id: DIARY },
    ]);
    const response = await app.inject({
      method: 'GET',
      url: `/projects?limit=1&offset=2`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ id: ID }],
      nextOffset: 3,
    });
    expect(repository.listByTeamId).toHaveBeenCalledWith(TEAM, false, {
      limit: 2,
      offset: 2,
    });
  });
  it('lets team managers create projects including in personal teams', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/projects`,
      headers,
      payload: { name: 'Research' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ id: ID, teamId: TEAM });
    expect(repository.create).toHaveBeenCalledWith({
      teamId: TEAM,
      name: 'Research',
      creator: { kind: 'agent', id: VALID_AUTH_CONTEXT.agentId },
    });
  });
  it('attributes human-created projects to the internal human ID', async () => {
    authContext = HUMAN_AUTH_CONTEXT;
    const response = await app.inject({
      method: 'POST',
      url: `/projects`,
      headers,
      payload: { name: 'Research' },
    });
    expect(response.statusCode).toBe(201);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        creator: { kind: 'human', id: HUMAN_AUTH_CONTEXT.humanId },
      }),
    );
  });
  it('rejects member updates without modifying the project', async () => {
    mocks.permissionChecker.canWriteTeam.mockResolvedValue(false);
    const response = await app.inject({
      method: 'PATCH',
      url: `/projects/${ID}`,
      headers,
      payload: { archived: true },
    });
    expect(response.statusCode).toBe(403);
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('hides catalogue discovery from non-members', async () => {
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(false);
    const response = await app.inject({
      url: `/projects`,
      headers,
    });
    expect(response.statusCode).toBe(404);
    expect(repository.listByTeamId).not.toHaveBeenCalled();
  });
  it('rejects an empty project update before writing', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/projects/${ID}`,
      headers,
    });
    expect(response.statusCode).toBe(400);
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('forbids members from administering projects', async () => {
    mocks.permissionChecker.canWriteTeam.mockResolvedValue(false);
    const response = await app.inject({
      method: 'POST',
      url: `/projects`,
      headers,
      payload: { name: 'Research' },
    });
    expect(response.statusCode).toBe(403);
    expect(repository.create).not.toHaveBeenCalled();
  });
  it('allows team discovery but hides projects from non-members', async () => {
    expect((await app.inject({ url: `/projects`, headers })).statusCode).toBe(
      200,
    );
    expect(repository.listByTeamId).toHaveBeenCalledWith(TEAM, false, {
      limit: 51,
      offset: 0,
    });
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(false);
    expect(
      (await app.inject({ url: `/projects/${ID}`, headers })).statusCode,
    ).toBe(404);
  });
  it('rejects a default diary from a different team', async () => {
    mocks.diaryService.findDiary.mockResolvedValue({ id: DIARY, teamId: ID });
    const response = await app.inject({
      method: 'POST',
      url: `/projects`,
      headers,
      payload: { name: 'Research', defaultDiaryId: DIARY },
    });
    expect(response.statusCode).toBe(400);
    expect(repository.create).not.toHaveBeenCalled();
  });
  it('does not return a project addressed through another team', async () => {
    repository.findById.mockResolvedValue({ ...project, teamId: ID });
    expect(
      (await app.inject({ url: `/projects/${ID}`, headers })).statusCode,
    ).toBe(404);
  });
  it('archives without deleting and can list archived projects explicitly', async () => {
    repository.update.mockResolvedValue({ ...project, archived: true });
    const response = await app.inject({
      method: 'PATCH',
      url: `/projects/${ID}`,
      headers,
      payload: { archived: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().archived).toBe(true);
    expect(repository.update).toHaveBeenCalledWith(ID, TEAM, {
      archived: true,
    });
    await app.inject({
      url: `/projects?includeArchived=true`,
      headers,
    });
    expect(repository.listByTeamId).toHaveBeenCalledWith(TEAM, true, {
      limit: 51,
      offset: 0,
    });
  });
  it.each(['GET', 'POST', 'PATCH'] as const)(
    'rejects a bound credential from another team for %s',
    async (method) => {
      authContext = KEY_AUTH_CONTEXT;
      const response = await app.inject({
        method,
        url: `/projects${method === 'PATCH' ? `/${ID}` : ''}`,
        headers,
        ...(method === 'GET' ? {} : { payload: { name: 'Research' } }),
      });
      expect(response.statusCode).toBe(403);
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.listByTeamId).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    },
  );
  it('reports an unavailable default diary as a field validation error', async () => {
    mocks.diaryService.findDiary.mockRejectedValue(
      new DiaryServiceError('not_found', 'Diary not found'),
    );
    const response = await app.inject({
      method: 'POST',
      url: `/projects`,
      headers,
      payload: { name: 'Research', defaultDiaryId: DIARY },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      errors: [expect.objectContaining({ field: 'defaultDiaryId' })],
    });
    expect(repository.create).not.toHaveBeenCalled();
  });
  it('never transfers a project through update', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/projects/${ID}`,
      headers,
      payload: { name: 'Renamed', teamId: ID },
    });
    expect(response.statusCode).toBe(200);
    expect(repository.update).toHaveBeenCalledWith(ID, TEAM, {
      name: 'Renamed',
    });
  });
});
