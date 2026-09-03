/* eslint-disable no-console */
/**
 * Copy/verify/delete migration for Ory Keto's retired `subject_id` self tuples.
 *
 * Run a snapshot rehearsal first:
 *   pnpm exec tsx tools/db/migrate-legacy-keto-self-tuples.ts --dry-run
 *   pnpm exec tsx tools/db/migrate-legacy-keto-self-tuples.ts --apply
 *   pnpm exec tsx tools/db/migrate-legacy-keto-self-tuples.ts --verify
 *
 * Output is JSON on stdout; progress and diagnostics go to stderr. The command
 * only changes Agent#self and Human#self where object === subject_id. It
 * reports every other direct-subject tuple without touching it.
 */
import { config } from '@dotenvx/dotenvx';

import type {
  KetoTuple,
  LegacySelfTupleMode,
} from '../src/legacy-keto-self-tuple-migration.js';
import { migrateLegacySelfTuples } from '../src/legacy-keto-self-tuple-migration.js';

config({ path: ['env.public', '.env.infra.local'], override: false });

const selected = (['dry-run', 'apply', 'verify'] as const).filter((mode) =>
  process.argv.includes(`--${mode}`),
);
if (selected.length !== 1) {
  throw new Error('Specify exactly one of --dry-run, --apply, or --verify');
}
const mode: LegacySelfTupleMode = selected[0];
const pageSizeArg = process.argv.find((arg) => arg.startsWith('--page-size='));
const pageSize = Number(pageSizeArg?.split('=')[1] ?? '200');
if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
  throw new Error('--page-size must be an integer between 1 and 500');
}

const oryUrl = requiredEnv('ORY_PROJECT_URL').replace(/\/$/, '');
const apiKey = process.env.ORY_PROJECT_API_KEY ?? process.env.ORY_API_KEY;
if (!apiKey || apiKey.startsWith('encrypted:')) {
  throw new Error('ORY_PROJECT_API_KEY is required and must be decrypted');
}
const headers = { Authorization: `Bearer ${apiKey}` };

const result = await migrateLegacySelfTuples(
  {
    async listTuples(pageToken) {
      const params = new URLSearchParams({ page_size: String(pageSize) });
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
        throw new Error('Keto returned an unreadable relationship page');
      }
      return {
        items: body.relation_tuples,
        nextPageToken: body.next_page_token || undefined,
      };
    },
    async putTuple(tuple) {
      // Keto treats a pre-existing replacement as a successful resumed copy.
      await retryFetch(
        `${oryUrl}/admin/relation-tuples`,
        {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(tuple),
        },
        [200, 201, 204, 409],
      );
    },
    async tupleExists(tuple) {
      const params = tupleParams(tuple);
      const response = await retryFetch(
        `${oryUrl}/relation-tuples?${params.toString()}`,
        { headers },
      );
      const body = (await response.json()) as { relation_tuples?: KetoTuple[] };
      return (body.relation_tuples ?? []).some((candidate) =>
        sameTuple(candidate, tuple),
      );
    },
    async checkSelfPermission(tuple) {
      const params = tupleParams(tuple);
      const response = await retryFetch(
        `${oryUrl}/relation-tuples/check/openapi?${params.toString()}`,
        { headers },
      );
      const body = (await response.json()) as { allowed?: boolean };
      return body.allowed === true;
    },
    async deleteTuple(tuple) {
      const params = tupleParams(tuple);
      await retryFetch(`${oryUrl}/admin/relation-tuples?${params.toString()}`, {
        method: 'DELETE',
        headers,
      });
    },
  },
  mode,
);

console.log(JSON.stringify({ mode, pageSize, ...result }, null, 2));
if (result.counts.failed > 0) process.exitCode = 1;

function tupleParams(tuple: KetoTuple): URLSearchParams {
  const params = new URLSearchParams({
    namespace: tuple.namespace,
    object: tuple.object,
    relation: tuple.relation,
  });
  if (tuple.subject_set) {
    params.set('subject_set.namespace', tuple.subject_set.namespace);
    params.set('subject_set.object', tuple.subject_set.object);
    params.set('subject_set.relation', tuple.subject_set.relation);
  } else if (tuple.subject_id) {
    params.set('subject_id', tuple.subject_id);
  }
  return params;
}

function sameTuple(left: KetoTuple, right: KetoTuple): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
  acceptedStatuses = [200, 201, 204],
  attempts = 3,
): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(10_000),
      });
      if (acceptedStatuses.includes(response.status)) return response;
      const detail = await response.text();
      lastError = new Error(
        `${init.method ?? 'GET'} ${url} returned ${response.status}: ${detail}`,
      );
      if (response.status < 500 && response.status !== 429) throw lastError;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === attempts) break;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, attempt * 250);
    });
  }
  throw lastError ?? new Error(`${init.method ?? 'GET'} ${url} failed`);
}
