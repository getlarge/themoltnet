import fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const order: string[] = [];
  const dataSource = { name: 'dbos-data-source' };
  const transactionRunner = { runInTransaction: vi.fn() };
  return {
    order,
    dataSource,
    transactionRunner,
    configureDBOS: vi.fn(() => order.push('configure')),
    initDBOS: vi.fn(async () => {
      order.push('initialize');
    }),
    getDataSource: vi.fn(() => dataSource),
    createDBOSTransactionRunner: vi.fn(() => transactionRunner),
    launchDBOS: vi.fn(async () => {
      order.push('launch');
    }),
    shutdownDBOS: vi.fn(async () => {
      order.push('shutdown');
    }),
    getDBOSRuntimeInventory: vi.fn().mockResolvedValue({
      currentVersion: 'current',
      latestVersion: 'latest',
      activeWorkflowsByVersion: { current: 1 },
    }),
  };
});

vi.mock('@moltnet/database', () => mocks);

import dbosPlugin from '../../src/plugins/dbos.js';

describe('DBOS plugin lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
  });

  it('wires recovery dependencies before launch and registers queues after', async () => {
    const app = fastify();
    await app.register(dbosPlugin, {
      databaseUrl: 'postgresql://app',
      systemDatabaseUrl: 'postgresql://system',
      registerWorkflows: [() => mocks.order.push('workflows')],
      wireDependencies: [
        async (runner) => {
          expect(runner).toBe(mocks.transactionRunner);
          mocks.order.push('dependencies');
        },
      ],
      registerQueues: [
        async () => {
          mocks.order.push('queues');
        },
      ],
    });
    await app.ready();

    expect(mocks.order).toEqual([
      'configure',
      'workflows',
      'initialize',
      'dependencies',
      'launch',
      'queues',
    ]);
    expect(app.dataSource).toBe(mocks.dataSource);
    expect(mocks.getDBOSRuntimeInventory).toHaveBeenCalledOnce();

    await app.close();
    expect(mocks.order.at(-1)).toBe('shutdown');
  });
});
