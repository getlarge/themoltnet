import { setTimeout } from 'node:timers/promises';

import { DEFAULT_E2E_REST_API_URL } from '@moltnet/bootstrap';
import { Client } from 'pg';

/** The caller starts the API stack and initializes Absurd; setup only waits. */
export default async function setup() {
  process.env.ADAPTIVE_TEST_DATABASE_URL ??=
    'postgresql://absurd:absurd_secret@localhost:55434/absurd';
  const api = `${process.env.REST_API_URL ?? DEFAULT_E2E_REST_API_URL}/health`;
  for (let attempt = 0; attempt < 60; attempt++) {
    const db = new Client({
      connectionString: process.env.ADAPTIVE_TEST_DATABASE_URL,
      connectionTimeoutMillis: 2000,
    });
    try {
      await db.connect();
      await db.query('SELECT 1');
      if ((await fetch(api, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {
      /* Infrastructure is still starting. */
    } finally {
      await db.end().catch(() => {});
    }
    await setTimeout(2000);
  }
  throw new Error(
    'Adaptive review E2E API or Absurd database did not become ready',
  );
}
