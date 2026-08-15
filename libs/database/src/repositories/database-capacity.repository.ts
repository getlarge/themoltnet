import { sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import { getExecutor } from '../transaction-context.js';

export type DatabaseCapacityScope =
  | 'dbos'
  | 'transaction_completion'
  | 'diary_entries'
  | 'task_messages';

export interface DatabaseCapacitySnapshot {
  scope: DatabaseCapacityScope;
  sizeBytes: number;
}

export function createDatabaseCapacityRepository(db: Database) {
  return {
    async getSizeSnapshots(): Promise<DatabaseCapacitySnapshot[]> {
      const result = await getExecutor(db).execute(sql`
        WITH dbos_tables AS (
          SELECT c.oid
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'dbos'
            AND c.relkind IN ('r', 'm')
            AND c.relname <> 'transaction_completion'
        )
        SELECT
          'dbos'::text AS capacity_scope,
          COALESCE(sum(pg_total_relation_size(oid)), 0)::bigint AS size_bytes
        FROM dbos_tables
        UNION ALL
        SELECT
          'transaction_completion'::text,
          COALESCE(
            pg_total_relation_size(to_regclass('dbos.transaction_completion')),
            0
          )::bigint
        UNION ALL
        SELECT
          'diary_entries'::text,
          COALESCE(
            pg_total_relation_size(to_regclass('public.diary_entries')),
            0
          )::bigint
        UNION ALL
        SELECT
          'task_messages'::text,
          COALESCE(
            pg_total_relation_size(to_regclass('public.task_messages')),
            0
          )::bigint
      `);

      return result.rows.map((row) => {
        const values = row as {
          capacity_scope: DatabaseCapacityScope;
          size_bytes: string | number;
        };
        return {
          scope: values.capacity_scope,
          sizeBytes: Number(values.size_bytes),
        };
      });
    },
  };
}

export type DatabaseCapacityRepository = ReturnType<
  typeof createDatabaseCapacityRepository
>;
