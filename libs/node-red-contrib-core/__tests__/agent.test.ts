import { afterEach, describe, expect, it, vi } from 'vitest';

import agentNode from '../src/nodes/agent.js';
import { type FakeNode, FakeRed } from './fake-red.js';

/**
 * Mock the SDK boundary: the agent config node's only network seam is
 * `connect(...)`. We replace it with a spy that hands back a sentinel agent so
 * the tests assert on the node's caching + credential behavior, never the wire.
 */
const connectMock = vi.fn();
vi.mock('@themoltnet/sdk', () => ({
  connect: (opts: unknown) => connectMock(opts) as unknown,
}));

afterEach(() => {
  connectMock.mockReset();
});

/** Instantiate the config node with a def + optional credentials. */
function setup(
  def: Record<string, unknown> = {},
  credentials: Record<string, unknown> = {},
) {
  const red = new FakeRed();
  red.load(agentNode);
  const node = red.create('moltnet-agent', 'cfg', {
    ...def,
    credentials,
  }) as FakeNode & {
    apiUrl: string;
    clientId?: string;
    teamId?: string;
    diaryId?: string;
    getAgent: () => Promise<unknown>;
  };
  return { red, node };
}

describe('moltnet-agent', () => {
  it('exposes team/diary context and a defaulted apiUrl from config', () => {
    const { node } = setup({
      clientId: 'client-1',
      teamId: '  team-1  ',
      diaryId: 'diary-1',
    });
    // teamId/diaryId are trimmed; apiUrl falls back to the public endpoint.
    expect(node.teamId).toBe('team-1');
    expect(node.diaryId).toBe('diary-1');
    expect(node.apiUrl).toBe('https://api.themolt.net');
    expect(node.clientId).toBe('client-1');
  });

  it('honors an explicit apiUrl and leaves blank team/diary undefined', () => {
    const { node } = setup({
      clientId: 'client-1',
      apiUrl: 'https://staging.example.test',
      teamId: '   ',
    });
    expect(node.apiUrl).toBe('https://staging.example.test');
    expect(node.teamId).toBeUndefined();
    expect(node.diaryId).toBeUndefined();
  });

  it('connects once and caches the agent across getAgent() calls', async () => {
    const sentinel = { id: 'agent-sentinel' };
    connectMock.mockResolvedValue(sentinel);
    const { node } = setup(
      { clientId: 'client-1', apiUrl: 'https://api.themolt.net' },
      { clientSecret: 'secret-1' },
    );

    const first = await node.getAgent();
    const second = await node.getAgent();

    expect(first).toBe(sentinel);
    expect(second).toBe(sentinel);
    // One connect for two getAgent calls — the promise is cached.
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledWith({
      clientId: 'client-1',
      clientSecret: 'secret-1',
      apiUrl: 'https://api.themolt.net',
    });
  });

  it('rejects with a clear error when credentials are missing', async () => {
    const { node } = setup({ clientId: 'client-1' }, {});
    await expect(node.getAgent()).rejects.toThrow(
      /clientId and clientSecret are required/,
    );
    // Never reached the SDK.
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('does not cache a failed connect — a later call retries', async () => {
    connectMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 'agent-2' });
    const { node } = setup(
      { clientId: 'client-1' },
      { clientSecret: 'secret-1' },
    );

    await expect(node.getAgent()).rejects.toThrow(/boom/);
    // The rejected promise was cleared, so the next call connects again.
    const retried = await node.getAgent();
    expect(retried).toEqual({ id: 'agent-2' });
    expect(connectMock).toHaveBeenCalledTimes(2);
  });
});
