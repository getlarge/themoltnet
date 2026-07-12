import { describe, expect, it, vi } from 'vitest';

import { TaskAvailabilityWaiter } from '../src/services/task-availability.js';

class FakeListenerClient {
  readonly queries: string[] = [];
  readonly listeners = new Set<() => void>();
  released = false;

  async query(sql: string): Promise<void> {
    this.queries.push(sql);
  }

  on(_event: 'notification', listener: () => void): void {
    this.listeners.add(listener);
  }

  removeListener(_event: 'notification', listener: () => void): void {
    this.listeners.delete(listener);
  }

  release(): void {
    this.released = true;
  }

  notify(): void {
    for (const listener of this.listeners) listener();
  }
}

describe('TaskAvailabilityWaiter', () => {
  it('closes the LISTEN race by checking after subscription', async () => {
    const client = new FakeListenerClient();
    const isAvailable = vi.fn().mockResolvedValue(true);
    const waiter = new TaskAvailabilityWaiter({
      connect: async () => client,
    });

    await expect(
      waiter.waitForAvailable({ timeoutMs: 100, isAvailable }),
    ).resolves.toBe(true);

    expect(client.queries).toEqual([
      'LISTEN moltnet_task_available',
      'UNLISTEN moltnet_task_available',
    ]);
    expect(isAvailable).toHaveBeenCalledTimes(1);
    expect(client.listeners).toHaveLength(0);
    expect(client.released).toBe(true);
  });

  it('rechecks filters after a notification before reporting availability', async () => {
    const client = new FakeListenerClient();
    const isAvailable = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const waiter = new TaskAvailabilityWaiter({
      connect: async () => client,
    });

    const wait = waiter.waitForAvailable({ timeoutMs: 100, isAvailable });
    await vi.waitFor(() => expect(client.listeners).toHaveLength(1));
    client.notify();

    await expect(wait).resolves.toBe(true);
    expect(isAvailable).toHaveBeenCalledTimes(2);
    expect(client.listeners).toHaveLength(0);
    expect(client.released).toBe(true);
  });

  it('times out and releases the listener when no matching task arrives', async () => {
    const client = new FakeListenerClient();
    const waiter = new TaskAvailabilityWaiter({
      connect: async () => client,
    });

    await expect(
      waiter.waitForAvailable({
        timeoutMs: 1,
        isAvailable: async () => false,
      }),
    ).resolves.toBe(false);

    expect(client.listeners).toHaveLength(0);
    expect(client.released).toBe(true);
  });

  it('wakes independent daemon waiters from the same queue transition', async () => {
    const first = new FakeListenerClient();
    const second = new FakeListenerClient();
    const clients = [first, second];
    const waiter = new TaskAvailabilityWaiter({
      connect: async () => {
        const client = clients.shift();
        if (!client) throw new Error('unexpected connection');
        return client;
      },
    });
    let ready = false;
    const firstWait = waiter.waitForAvailable({
      timeoutMs: 100,
      isAvailable: async () => ready,
    });
    const secondWait = waiter.waitForAvailable({
      timeoutMs: 100,
      isAvailable: async () => ready,
    });
    await vi.waitFor(() => {
      expect(first.listeners).toHaveLength(1);
      expect(second.listeners).toHaveLength(1);
    });

    ready = true;
    first.notify();
    second.notify();

    await expect(Promise.all([firstWait, secondWait])).resolves.toEqual([
      true,
      true,
    ]);
  });
});
