import { sql, type SQL } from 'drizzle-orm';

import type { Database } from './db.js';
import { getExecutor, hasActiveTransaction } from './transaction-context.js';

export interface TransactionalWorkflowEnqueueInput {
  workflowName: string;
  queueName: string;
  positionalArgs?: readonly unknown[];
  namedArgs?: Record<string, unknown>;
  workflowId?: string;
  appVersion?: string;
  timeoutMs?: number;
  deadlineEpochMs?: number;
  deduplicationId?: string;
  priority?: number;
  queuePartitionKey?: string;
  /**
   * DBOS system schema. MoltNet uses `dbos`; keeping this configurable makes
   * restored databases and tests explicit.
   */
  schemaName?: string;
}

export interface TransactionalWorkflowEnqueueResult {
  workflowId: string;
}

interface EnqueueWorkflowRow {
  workflow_id: string;
}

function jsonArgArray(args: readonly unknown[]): SQL {
  if (args.length === 0) {
    return sql`ARRAY[]::json[]`;
  }

  return sql`ARRAY[${sql.join(
    args.map((arg) => sql`${JSON.stringify(arg)}::json`),
    sql`, `,
  )}]::json[]`;
}

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function rowsFromExecute(result: unknown): EnqueueWorkflowRow[] {
  if (
    typeof result === 'object' &&
    result !== null &&
    'rows' in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: EnqueueWorkflowRow[] }).rows;
  }
  if (Array.isArray(result)) {
    return result as EnqueueWorkflowRow[];
  }
  return [];
}

/**
 * Enqueue a DBOS workflow by calling DBOS's Postgres UDF from the current
 * TransactionRunner-managed transaction.
 *
 * This does not ask the DBOS TypeScript runtime to open or join a second
 * connection. The current app transaction calls `dbos.enqueue_workflow(...)`
 * on its own Postgres connection, so app table writes and the DBOS
 * `workflow_status` row commit or roll back together.
 *
 * The UDF stores inputs using DBOS portable JSON. Workflows enqueued this way
 * must be compatible with `serialization: 'portable'` inputs.
 */
export async function enqueueWorkflowInCurrentTransaction(
  db: Database,
  input: TransactionalWorkflowEnqueueInput,
): Promise<TransactionalWorkflowEnqueueResult> {
  if (!hasActiveTransaction()) {
    throw new Error(
      'enqueueWorkflowInCurrentTransaction must run inside TransactionRunner.runInTransaction()',
    );
  }

  const schemaName = input.schemaName ?? 'dbos';
  const positionalArgs = jsonArgArray(input.positionalArgs ?? []);
  const namedArgs = JSON.stringify(input.namedArgs ?? {});

  const result = await getExecutor(db).execute(sql`
    select ${sql.identifier(schemaName)}.enqueue_workflow(
      workflow_name := ${input.workflowName},
      queue_name := ${input.queueName},
      positional_args := ${positionalArgs},
      named_args := ${namedArgs}::json,
      workflow_id := ${nullable(input.workflowId)},
      app_version := ${nullable(input.appVersion)},
      timeout_ms := ${nullable(input.timeoutMs)},
      deadline_epoch_ms := ${nullable(input.deadlineEpochMs)},
      deduplication_id := ${nullable(input.deduplicationId)},
      priority := ${nullable(input.priority)},
      queue_partition_key := ${nullable(input.queuePartitionKey)}
    ) as workflow_id
  `);

  const [row] = rowsFromExecute(result);
  if (!row?.workflow_id) {
    throw new Error('DBOS enqueue_workflow did not return a workflow id');
  }

  return { workflowId: row.workflow_id };
}
