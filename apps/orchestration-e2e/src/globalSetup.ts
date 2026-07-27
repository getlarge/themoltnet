/**
 * Orchestration E2E Global Setup — Absurd Postgres readiness.
 *
 * The durability suite proves that `@themoltnet/tasks-orchestrator`'s `ctx.step`
 * checkpoints replay from a REAL Absurd store after a mid-run crash. That needs
 * an Absurd-initialized Postgres — the `issue-lifecycle-db` service in
 * docker-compose.e2e.yaml, whose `issue-lifecycle-db-migrate` sibling installs
 * the Absurd schema. The Compose stack is brought up before the suite runs (CI,
 * or `pnpm run e2e:up` locally); we only wait for the DB to accept connections.
 */
import { Client } from 'pg';

const ABSURD_URL_DEFAULT =
  'postgresql://issue_lifecycle:issue_lifecycle_secret@localhost:55434/issue_lifecycle';

async function waitForPostgres(url: string, maxAttempts = 60): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch {
      await client.end().catch(() => undefined);
      await new Promise((resolve) => {
        setTimeout(resolve, 2_000);
      });
    }
  }
  throw new Error(
    `Absurd Postgres at ${url} did not accept connections after ${maxAttempts} attempts`,
  );
}

export default async function setup() {
  process.env.ORCHESTRATION_ABSURD_URL ??= ABSURD_URL_DEFAULT;
  // eslint-disable-next-line no-console
  console.log('[Orchestration E2E] Waiting for Absurd Postgres...');
  await waitForPostgres(process.env.ORCHESTRATION_ABSURD_URL);
  // eslint-disable-next-line no-console
  console.log('[Orchestration E2E] Absurd Postgres ready');
}
