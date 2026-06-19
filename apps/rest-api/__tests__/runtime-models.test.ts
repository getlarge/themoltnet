import { type RuntimeModel, UniqueViolationError } from '@moltnet/database';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  OWNER_ID,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const TEAM_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const ENTRY_ID = 'eeeeeeee-0000-0000-0000-000000000005';
const GLOBAL_ENTRY_ID = 'eeeeeeee-0000-0000-0000-0000000000aa';

function mockModel(overrides: Partial<RuntimeModel> = {}): RuntimeModel {
  return {
    id: ENTRY_ID,
    teamId: TEAM_ID,
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    displayName: 'Anthropic · Claude Sonnet 4.5',
    description: null,
    capabilities: { supportsTools: true, contextWindow: 200000 },
    isActive: true,
    createdByAgentId: OWNER_ID,
    createdByHumanId: null,
    createdAt: new Date('2026-06-14T10:00:00.000Z'),
    updatedAt: new Date('2026-06-14T10:00:00.000Z'),
    ...overrides,
  };
}

function mockGlobalModel(overrides: Partial<RuntimeModel> = {}): RuntimeModel {
  return mockModel({ id: GLOBAL_ENTRY_ID, teamId: null, ...overrides });
}

describe('runtime model catalog routes', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  describe('GET /runtime-models', () => {
    it('returns global entries when no team header is set', async () => {
      mocks.runtimeModelRepository.listVisible.mockResolvedValue([
        mockGlobalModel(),
        mockGlobalModel({
          id: 'eeeeeeee-0000-0000-0000-0000000000bb',
          provider: 'openai',
          model: 'gpt-5.1',
        }),
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/runtime-models',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toHaveLength(2);
      expect(body.items[0]).toMatchObject({
        id: GLOBAL_ENTRY_ID,
        teamId: null,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
      });
      expect(mocks.runtimeModelRepository.listVisible).toHaveBeenCalledWith({
        teamId: undefined,
        provider: undefined,
      });
    });

    it('passes the team id and provider filter through to the repository', async () => {
      mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
      mocks.runtimeModelRepository.listVisible.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/runtime-models?provider=ollama',
        headers: {
          authorization: 'Bearer test-token',
          'x-moltnet-team-id': TEAM_ID,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.runtimeModelRepository.listVisible).toHaveBeenCalledWith({
        teamId: TEAM_ID,
        provider: 'ollama',
      });
    });
  });

  describe('POST /runtime-models', () => {
    it('creates a team-scoped entry when the caller can manage the team', async () => {
      mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
      mocks.permissionChecker.canManageTeam.mockResolvedValue(true);
      mocks.teamRepository.findById.mockResolvedValue({ id: TEAM_ID });
      mocks.runtimeModelRepository.create.mockResolvedValue(mockModel());

      const response = await app.inject({
        method: 'POST',
        url: '/runtime-models',
        headers: {
          authorization: 'Bearer test-token',
          'x-moltnet-team-id': TEAM_ID,
        },
        payload: {
          provider: 'Anthropic',
          model: 'Claude-Sonnet-4-5',
          displayName: 'Anthropic · Claude Sonnet 4.5',
          capabilities: { supportsTools: true, contextWindow: 200000 },
        },
      });

      expect(response.statusCode).toBe(201);
      expect(mocks.runtimeModelRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId: TEAM_ID,
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          displayName: 'Anthropic · Claude Sonnet 4.5',
          isActive: true,
          createdByAgentId: OWNER_ID,
          createdByHumanId: null,
        }),
      );
    });

    it('rejects requests without a team header (creation is team-scoped)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime-models',
        headers: { authorization: 'Bearer test-token' },
        payload: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.runtimeModelRepository.create).not.toHaveBeenCalled();
    });

    it('rejects when the caller cannot manage the team', async () => {
      mocks.permissionChecker.canManageTeam.mockResolvedValue(false);

      const response = await app.inject({
        method: 'POST',
        url: '/runtime-models',
        headers: {
          authorization: 'Bearer test-token',
          'x-moltnet-team-id': TEAM_ID,
        },
        payload: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      });

      expect(response.statusCode).toBe(403);
      expect(mocks.runtimeModelRepository.create).not.toHaveBeenCalled();
    });

    it('maps a unique violation to 409', async () => {
      mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
      mocks.permissionChecker.canManageTeam.mockResolvedValue(true);
      mocks.teamRepository.findById.mockResolvedValue({ id: TEAM_ID });
      mocks.runtimeModelRepository.create.mockRejectedValue(
        new UniqueViolationError({
          constraint: 'runtime_models_team_uq',
          target: {
            resource: 'runtime-model',
            keys: {
              teamId: TEAM_ID,
              provider: 'anthropic',
              model: 'claude-sonnet-4-5',
            },
          },
        }),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/runtime-models',
        headers: {
          authorization: 'Bearer test-token',
          'x-moltnet-team-id': TEAM_ID,
        },
        payload: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 'CONFLICT',
        conflict: {
          constraint: 'runtime_models_team_uq',
          target: {
            resource: 'runtime-model',
            keys: {
              teamId: TEAM_ID,
              provider: 'anthropic',
              model: 'claude-sonnet-4-5',
            },
          },
        },
      });
    });
  });

  describe('PATCH /runtime-models/:modelId', () => {
    it('updates a team-scoped entry', async () => {
      mocks.permissionChecker.canManageTeam.mockResolvedValue(true);
      mocks.runtimeModelRepository.findById.mockResolvedValue(mockModel());
      mocks.runtimeModelRepository.update.mockResolvedValue(
        mockModel({ displayName: 'Renamed' }),
      );

      const response = await app.inject({
        method: 'PATCH',
        url: `/runtime-models/${ENTRY_ID}`,
        headers: { authorization: 'Bearer test-token' },
        payload: { displayName: 'Renamed' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ displayName: 'Renamed' });
      expect(mocks.runtimeModelRepository.update).toHaveBeenCalledWith(
        ENTRY_ID,
        expect.objectContaining({ displayName: 'Renamed' }),
      );
    });

    it('refuses to update a global entry via the public API', async () => {
      mocks.runtimeModelRepository.findById.mockResolvedValue(
        mockGlobalModel(),
      );

      const response = await app.inject({
        method: 'PATCH',
        url: `/runtime-models/${GLOBAL_ENTRY_ID}`,
        headers: { authorization: 'Bearer test-token' },
        payload: { displayName: 'Renamed' },
      });

      expect(response.statusCode).toBe(403);
      expect(mocks.runtimeModelRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /runtime-models/:modelId', () => {
    it('deletes a team-scoped entry', async () => {
      mocks.permissionChecker.canManageTeam.mockResolvedValue(true);
      mocks.runtimeModelRepository.findById.mockResolvedValue(mockModel());
      mocks.runtimeModelRepository.delete.mockResolvedValue(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/runtime-models/${ENTRY_ID}`,
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(204);
      expect(mocks.runtimeModelRepository.delete).toHaveBeenCalledWith(
        ENTRY_ID,
      );
    });

    it('refuses to delete a global entry via the public API', async () => {
      mocks.runtimeModelRepository.findById.mockResolvedValue(
        mockGlobalModel(),
      );

      const response = await app.inject({
        method: 'DELETE',
        url: `/runtime-models/${GLOBAL_ENTRY_ID}`,
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(403);
      expect(mocks.runtimeModelRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('GET /runtime-models/:modelId', () => {
    it('returns a global entry to any authenticated caller', async () => {
      mocks.runtimeModelRepository.findById.mockResolvedValue(
        mockGlobalModel(),
      );

      const response = await app.inject({
        method: 'GET',
        url: `/runtime-models/${GLOBAL_ENTRY_ID}`,
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: GLOBAL_ENTRY_ID,
        teamId: null,
        provider: 'anthropic',
      });
    });

    it('hides a team-scoped entry from non-members', async () => {
      mocks.runtimeModelRepository.findById.mockResolvedValue(mockModel());
      mocks.permissionChecker.canAccessTeam.mockResolvedValue(false);

      const response = await app.inject({
        method: 'GET',
        url: `/runtime-models/${ENTRY_ID}`,
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
