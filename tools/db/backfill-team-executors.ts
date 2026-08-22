/* eslint-disable no-console */
import { config } from '@dotenvx/dotenvx';

import {
  backfillTeamExecutors,
  type TeamExecutorBackfillAdapters,
  type TeamRoleTuple,
} from '../src/team-executor-backfill.js';

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

const adapters: TeamExecutorBackfillAdapters = {
  async listTuples({ relation, pageToken }) {
    const params = new URLSearchParams({
      namespace: 'Team',
      relation,
      page_size: '500',
    });
    if (pageToken) params.set('page_token', pageToken);
    const response = await retryFetch(
      `${oryUrl}/relation-tuples?${params.toString()}`,
      { headers },
    );
    const body = (await response.json()) as {
      relation_tuples?: TeamRoleTuple[];
      next_page_token?: string;
    };
    if (!Array.isArray(body.relation_tuples)) {
      throw new Error(`Unreadable Keto Team#${relation} page`);
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

const result = await backfillTeamExecutors(adapters, mode);
console.log(
  JSON.stringify(
    {
      mode,
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
    }
    if (attempt < attempts) {
      await new Promise((resolve) => {
        setTimeout(resolve, attempt * 250);
      });
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Keto request failed');
}
