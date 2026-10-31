import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db.js';
import { enqueueWorkflowInCurrentTransaction } from '../src/dbos-transactional-enqueue.js';
import { createDrizzleTransactionRunner } from '../src/transaction-context.js';

describe('enqueueWorkflowInCurrentTransaction', () => {
  it('requires an ambient TransactionRunner transaction', async () => {
    const db = { execute: vi.fn() } as unknown as Database;

    await expect(
      enqueueWorkflowInCurrentTransaction(db, {
        workflowName: 'task.workflow.startAttempt',
        queueName: 'task-attempts',
        workflowId: 'workflow-1',
      }),
    ).rejects.toThrow(
      'enqueueWorkflowInCurrentTransaction must run inside TransactionRunner.runInTransaction()',
    );

    expect(db.execute).not.toHaveBeenCalled();
  });

  it('executes the DBOS UDF on the transaction executor', async () => {
    const tx = {
      execute: vi
        .fn()
        .mockResolvedValue({ rows: [{ workflow_id: 'workflow-1' }] }),
    };
    const db = {
      execute: vi.fn(),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
    } as unknown as Database;
    const runner = createDrizzleTransactionRunner(db);

    const result = await runner.runInTransaction(() =>
      enqueueWorkflowInCurrentTransaction(db, {
        workflowName: 'task.workflow.startAttempt',
        queueName: 'task-attempts',
        workflowId: 'workflow-1',
        positionalArgs: ['task-1', 1, 'agent-1'],
      }),
    );

    expect(result).toEqual({ workflowId: 'workflow-1' });
    expect(db.execute).not.toHaveBeenCalled();
    expect(tx.execute).toHaveBeenCalledOnce();
  });

  it('fails if DBOS does not return a workflow id', async () => {
    const tx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    const db = {
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
    } as unknown as Database;
    const runner = createDrizzleTransactionRunner(db);

    await expect(
      runner.runInTransaction(() =>
        enqueueWorkflowInCurrentTransaction(db, {
          workflowName: 'task.workflow.startAttempt',
          queueName: 'task-attempts',
        }),
      ),
    ).rejects.toThrow('DBOS enqueue_workflow did not return a workflow id');
  });
});
