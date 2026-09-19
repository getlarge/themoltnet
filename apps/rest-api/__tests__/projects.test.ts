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
  type MockServices,
  resetMockServices,
  TEST_BEARER_TOKEN,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const TEAM = 'aa0e8400-e29b-41d4-a716-446655440011';
const ID = '990e8400-e29b-41d4-a716-446655440010';
const DIARY = 'bb0e8400-e29b-41d4-a716-446655440011';
const headers = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };
const project = {
  id: ID,
  teamId: TEAM,
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
  const repository = {
    create: vi.fn(),
    findById: vi.fn(),
    listByTeamId: vi.fn(),
    update: vi.fn(),
  };
  beforeAll(async () => {
    mocks = createMockServices();
    Object.assign(mocks, { projectRepository: repository });
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    resetMockServices(mocks);
    Object.values(repository).forEach((mock) => mock.mockReset());
    repository.create.mockResolvedValue(project);
    repository.findById.mockResolvedValue(project);
    repository.listByTeamId.mockResolvedValue([project]);
    repository.update.mockResolvedValue(project);
    mocks.permissionChecker.canManageTeamMembers.mockResolvedValue(true);
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.teamRepository.findById.mockResolvedValue({ id: TEAM });
  });
  it('lets team managers create projects including in personal teams', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/teams/${TEAM}/projects`,
      headers,
      payload: { name: 'Research' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ id: ID, teamId: TEAM });
    expect(repository.create).toHaveBeenCalledWith({
      teamId: TEAM,
      name: 'Research',
    });
  });
  it('rejects an empty project update before writing', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/teams/${TEAM}/projects/${ID}`,
      headers,
    });
    expect(response.statusCode).toBe(400);
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('forbids members from administering projects', async () => {
    mocks.permissionChecker.canManageTeamMembers.mockResolvedValue(false);
    const response = await app.inject({
      method: 'POST',
      url: `/teams/${TEAM}/projects`,
      headers,
      payload: { name: 'Research' },
    });
    expect(response.statusCode).toBe(403);
    expect(repository.create).not.toHaveBeenCalled();
  });
  it('allows team discovery but hides projects from non-members', async () => {
    expect(
      (await app.inject({ url: `/teams/${TEAM}/projects`, headers }))
        .statusCode,
    ).toBe(200);
    expect(repository.listByTeamId).toHaveBeenCalledWith(TEAM, false);
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(false);
    expect(
      (await app.inject({ url: `/teams/${TEAM}/projects/${ID}`, headers }))
        .statusCode,
    ).toBe(404);
  });
  it('rejects a default diary from a different team', async () => {
    mocks.diaryService.findDiary.mockResolvedValue({ id: DIARY, teamId: ID });
    const response = await app.inject({
      method: 'POST',
      url: `/teams/${TEAM}/projects`,
      headers,
      payload: { name: 'Research', defaultDiaryId: DIARY },
    });
    expect(response.statusCode).toBe(400);
    expect(repository.create).not.toHaveBeenCalled();
  });
  it('does not return a project addressed through another team', async () => {
    repository.findById.mockResolvedValue({ ...project, teamId: ID });
    expect(
      (await app.inject({ url: `/teams/${TEAM}/projects/${ID}`, headers }))
        .statusCode,
    ).toBe(404);
  });
  it('archives without deleting and can list archived projects explicitly', async () => {
    repository.update.mockResolvedValue({ ...project, archived: true });
    const response = await app.inject({
      method: 'PATCH',
      url: `/teams/${TEAM}/projects/${ID}`,
      headers,
      payload: { archived: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().archived).toBe(true);
    expect(repository.update).toHaveBeenCalledWith(ID, TEAM, {
      archived: true,
    });
    await app.inject({
      url: `/teams/${TEAM}/projects?includeArchived=true`,
      headers,
    });
    expect(repository.listByTeamId).toHaveBeenCalledWith(TEAM, true);
  });
  it('never transfers a project through update', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/teams/${TEAM}/projects/${ID}`,
      headers,
      payload: { name: 'Renamed', teamId: ID },
    });
    for (const call of repository.update.mock.calls)
      expect(call[2]).not.toHaveProperty('teamId');
  });
});
