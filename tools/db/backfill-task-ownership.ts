/* eslint-disable no-console */
/**
 * Backfill issue #1656 Task ownership and explicit grants in Keto.
 *
 *   pnpm exec tsx tools/db/backfill-task-ownership.ts --dry-run
 *   pnpm exec tsx tools/db/backfill-task-ownership.ts --apply
 *   pnpm exec tsx tools/db/backfill-task-ownership.ts --verify
 */
import { config } from '@dotenvx/dotenvx';
import { createDatabase } from '@moltnet/database';
import { sql } from 'drizzle-orm';

import {
  backfillTaskOwnership,
  type KetoTuple,
  type TaskOwnershipBackfillAdapters,
} from '../src/task-ownership-backfill.js';

config({ path: ['env.public', '.env.infra.local'], override: false });

const selected = (['dry-run', 'apply', 'verify'] as const).filter((mode) =>
  process.argv.includes(`--${mode}`),
);
if (selected.length !== 1) {
  throw new Error('Specify exactly one of --dry-run, --apply, or --verify');
}
const mode = selected[0];
const databaseUrl = requiredEnv('DATABASE_URL');
const oryUrl = requiredEnv('ORY_PROJECT_URL').replace(/\/$/, '');
const apiKey = process.env.ORY_PROJECT_API_KEY ?? process.env.ORY_API_KEY;
if (!apiKey) throw new Error('ORY_PROJECT_API_KEY is required');

const { db, pool } = createDatabase(databaseUrl);
const headers = { Authorization: `Bearer ${apiKey}` };
const pageSize = 250;

const adapters: TaskOwnershipBackfillAdapters = {
  async listTasks(cursor) {
    const result = await db.execute<{
      id: string;
      team_id: string | null;
      diary_id: string;
    }>(sql`
      SELECT id, team_id, diary_id
      FROM tasks
      WHERE (${cursor ?? null}::uuid IS NULL OR id > ${cursor ?? null}::uuid)
      ORDER BY id
      LIMIT ${pageSize}
    `);
    const rows = result.rows.map((row) => ({
      id: row.id,
      teamId: row.team_id,
      diaryId: row.diary_id,
    }));
    return {
      items: rows,
      nextPageToken: rows.length === pageSize ? rows.at(-1)?.id : undefined,
    };
  },

  async listTuples({ namespace, relation, pageToken }) {
    const params = new URLSearchParams({
      namespace,
      relation,
      page_size: '500',
    });
    if (pageToken) params.set('page_token', pageToken);
    const response = await retryFetch(
      `${oryUrl}/relation-tuples?${params.toString()}`,
      { headers },
    );
    const body = (await response.json()) as {
      relation_tuples?: KetoTuple[];
      next_page_token?: string;
    };
    if (!Array.isArray(body.relation_tuples)) {
      throw new Error(`Unreadable Keto ${namespace}#${relation} page`);
    }
    return {
      items: body.relation_tuples,
      nextPageToken: body.next_page_token || undefined,
    };
  },

  async putTuple(tuple) {
    await retryFetch(`${oryUrl}/admin/relation-tuples`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(tuple),
    });
  },
};

try {
  const result = await backfillTaskOwnership(adapters, mode);
  console.log(
    JSON.stringify(
      {
        mode,
        tasks: result.tasks,
        expectedTuples: result.expected,
        existingTuples: result.existing,
        insertedTuples: result.inserted,
        missingTuples: result.missing.length,
        ...(mode === 'dry-run' ? { missing: result.missing } : {}),
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith('encrypted:')) {
    throw new Error(`${name} is required and must be decrypted`);
  }
  return value;
}

async function retryFetch(
  url: string,
  init: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      const detail = await response.text();
      lastError = new Error(`Keto ${response.status}: ${detail}`);
      if (response.status < 500 && response.status !== 429) throw lastError;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, attempt * 250);
    });
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Keto request failed');
}
