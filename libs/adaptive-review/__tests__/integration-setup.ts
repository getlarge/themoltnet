import { Client } from 'pg';

/** Use an explicitly selected test database; never start infrastructure here. */
export default async function setup(): Promise<void> {
  const connectionString = process.env.ADAPTIVE_TEST_DATABASE_URL;
  if (!connectionString)
    throw new Error(
      'Set ADAPTIVE_TEST_DATABASE_URL to an initialized Absurd test database.',
    );
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const result = await client.query<{ ready: boolean }>(
      "SELECT EXISTS (SELECT FROM pg_namespace WHERE nspname = 'absurd') AS ready",
    );
    if (!result.rows[0].ready)
      throw new Error('The selected test database has no Absurd schema.');
  } finally {
    await client.end();
  }
}
