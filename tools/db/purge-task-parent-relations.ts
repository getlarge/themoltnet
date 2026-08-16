/* eslint-disable no-console */
/**
 * Purge inert Task#parent provenance tuples after the #1656 rollback window.
 *
 *   pnpm exec tsx tools/db/purge-task-parent-relations.ts --dry-run
 *   pnpm exec tsx tools/db/purge-task-parent-relations.ts --apply
 *   pnpm exec tsx tools/db/purge-task-parent-relations.ts --verify
 */
import { config } from '@dotenvx/dotenvx';

import type { KetoTuple } from '../src/task-ownership-backfill.js';
import {
  purgeTaskParentRelations,
  type TaskParentPurgeAdapters,
} from '../src/task-parent-purge.js';

config({ path: ['env.public', '.env.infra.local'], override: false });

const selected = (['dry-run', 'apply', 'verify'] as const).filter((mode) =>
  process.argv.includes(`--${mode}`),
);
if (selected.length !== 1) {
  throw new Error('Specify exactly one of --dry-run, --apply, or --verify');
}
const mode = selected[0];
const oryUrl = requiredEnv('ORY_PROJECT_URL').replace(/\/$/, '');
const apiKey = process.env.ORY_PROJECT_API_KEY ?? process.env.ORY_API_KEY;
if (!apiKey) throw new Error('ORY_PROJECT_API_KEY is required');

const headers = { Authorization: `Bearer ${apiKey}` };
const adapters: TaskParentPurgeAdapters = {
  async listParentTuples(pageToken) {
    const params = new URLSearchParams({
      namespace: 'Task',
      relation: 'parent',
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
      throw new Error('Unreadable Keto Task#parent page');
    }
    return {
      items: body.relation_tuples,
      nextPageToken: body.next_page_token || undefined,
    };
  },

  async deleteTuples(tuples) {
    await retryFetch(`${oryUrl}/admin/relation-tuples`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        tuples.map((tuple) => ({
          action: 'delete',
          relation_tuple: tuple,
        })),
      ),
    });
  },
};

const result = await purgeTaskParentRelations(adapters, mode);
console.log(
  JSON.stringify(
    {
      mode,
      foundTuples: result.found,
      deletedTuples: result.deleted,
      remainingTuples: result.remaining.length,
      ...(mode === 'dry-run' ? { tuples: result.remaining } : {}),
    },
    null,
    2,
  ),
);

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
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await retryDelay(attempt);
      continue;
    }

    if (response.ok) return response;
    const detail = await response.text();
    lastError = new Error(`Keto ${response.status}: ${detail}`);
    if (response.status < 500 && response.status !== 429) throw lastError;
    if (attempt < attempts) await retryDelay(attempt);
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Keto request failed');
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, attempt * 250);
  });
}
