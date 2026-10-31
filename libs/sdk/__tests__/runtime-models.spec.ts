import type { Client } from '@moltnet/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgent } from '../src/agent.js';
import { MoltNetError } from '../src/errors.js';
import { connectHuman } from '../src/human.js';

const TEAM_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const MODEL_ID = 'bbbbbbbb-0000-4000-8000-000000000002';

describe('RuntimeModelsNamespace', () => {
  const get = vi.fn();
  const post = vi.fn();
  const patch = vi.fn();
  const del = vi.fn();
  const client = { get, post, patch, delete: del } as unknown as Client;
  const auth = vi.fn().mockResolvedValue('agent-token');
  const models = createAgent({ client, auth }).runtimeModels;

  beforeEach(() => vi.clearAllMocks());

  it('lists global models and filters team models by provider', async () => {
    get.mockResolvedValue({ data: { items: [] } });

    await expect(models.list()).resolves.toEqual({ items: [] });
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/runtime-models',
        headers: undefined,
        query: undefined,
      }),
    );

    await models.list({ teamId: TEAM_ID, provider: 'openai' });
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/runtime-models',
        headers: expect.objectContaining({ 'x-moltnet-team-id': TEAM_ID }),
        query: { provider: 'openai' },
        auth: expect.any(Function),
      }),
    );
  });

  it('creates a team model with the required team header', async () => {
    const model = {
      id: MODEL_ID,
      teamId: TEAM_ID,
      provider: 'local',
      model: 'llama',
    };
    post.mockResolvedValue({ data: model });

    await expect(
      models.create({ provider: 'local', model: 'llama' }, { teamId: TEAM_ID }),
    ).resolves.toEqual(model);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/runtime-models',
        headers: expect.objectContaining({ 'x-moltnet-team-id': TEAM_ID }),
        body: { provider: 'local', model: 'llama' },
      }),
    );
  });

  it('gets, updates, and deletes a model by ID', async () => {
    const model = { id: MODEL_ID, provider: 'local', model: 'llama' };
    get.mockResolvedValue({ data: model });
    patch.mockResolvedValue({ data: { ...model, displayName: 'Local Llama' } });
    del.mockResolvedValue({ data: undefined });

    await expect(models.get(MODEL_ID)).resolves.toEqual(model);
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/runtime-models/{modelId}',
        path: { modelId: MODEL_ID },
      }),
    );

    await expect(
      models.update(MODEL_ID, { displayName: 'Local Llama' }),
    ).resolves.toEqual({ ...model, displayName: 'Local Llama' });
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/runtime-models/{modelId}',
        path: { modelId: MODEL_ID },
        body: { displayName: 'Local Llama' },
      }),
    );

    await expect(models.delete(MODEL_ID)).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/runtime-models/{modelId}',
        path: { modelId: MODEL_ID },
      }),
    );
  });

  it('propagates API errors, including delete errors', async () => {
    const error = { status: 403, title: 'Forbidden' };
    patch.mockResolvedValue({
      error,
      response: { status: 403, statusText: 'Forbidden' },
    });
    del.mockResolvedValue({
      error,
      response: { status: 403, statusText: 'Forbidden' },
    });

    await expect(
      models.update(MODEL_ID, { isActive: false }),
    ).rejects.toBeInstanceOf(MoltNetError);
    await expect(models.delete(MODEL_ID)).rejects.toBeInstanceOf(MoltNetError);
  });

  it('is available through a human client', async () => {
    get.mockResolvedValue({ data: { items: [] } });
    const human = connectHuman({ client, bearerToken: 'human-token' });

    await expect(
      human.runtimeModels.list({ teamId: TEAM_ID }),
    ).resolves.toEqual({ items: [] });
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/runtime-models',
        headers: expect.objectContaining({ 'x-moltnet-team-id': TEAM_ID }),
        auth: expect.any(Function),
      }),
    );
  });
});
