import { Client } from 'pg';

export interface ReviewRetentionPolicy {
  completedDays: number;
  unfinishedDays: number;
}

const DEFAULT_REVIEW_RETENTION: ReviewRetentionPolicy = {
  completedDays: 30,
  unfinishedDays: 90,
};

export function reviewRetentionPolicy(
  env: NodeJS.ProcessEnv,
): ReviewRetentionPolicy {
  const days = (key: string, fallback: number): number => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isSafeInteger(value) || value < 1 || value > 36500)
      throw new Error(`${key} must be a whole number of days from 1 to 36500`);
    return value;
  };
  return {
    completedDays: days('ADAPTIVE_RETENTION_COMPLETED_DAYS', 30),
    unfinishedDays: days('ADAPTIVE_RETENTION_UNFINISHED_DAYS', 90),
  };
}

// This table belongs to the coordinator, not the application's Drizzle schema.
// Tombstones contain only the hashed queue name and timestamps, never inputs.
async function initialize(
  client: Client,
  requestedPolicy?: ReviewRetentionPolicy,
): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('adaptive-review:retention-schema', 0))",
    );
    const existing = await client.query<{ present: boolean }>(
      "SELECT to_regclass('public.adaptive_review_retention') IS NOT NULL AS present",
    );
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.adaptive_review_retention (
        queue_name text PRIMARY KEY CHECK (queue_name ~ '^adaptive-[a-f0-9]{24}$'),
        last_used_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        published boolean NOT NULL DEFAULT false,
        expired_at timestamptz
      )`);
    await client.query(`
      CREATE INDEX IF NOT EXISTS adaptive_review_retention_live
      ON public.adaptive_review_retention (last_used_at) WHERE expired_at IS NULL`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.adaptive_review_retention_policy (
        singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
        completed_days integer NOT NULL CHECK (completed_days BETWEEN 1 AND 36500),
        unfinished_days integer NOT NULL CHECK (unfinished_days BETWEEN 1 AND 36500)
      )`);
    // Earlier hosts had no policy record. Adopt their documented default,
    // never let an arriving caller shorten retention of existing executions.
    const initial = existing.rows[0].present
      ? DEFAULT_REVIEW_RETENTION
      : (requestedPolicy ?? DEFAULT_REVIEW_RETENTION);
    await client.query(
      `INSERT INTO public.adaptive_review_retention_policy
         (singleton, completed_days, unfinished_days) VALUES (true, $1, $2)
       ON CONFLICT DO NOTHING`,
      [initial.completedDays, initial.unfinishedDays],
    );
    if (requestedPolicy) await assertRetentionPolicy(client, requestedPolicy);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** Call inside the deletion transaction: policy updates wait for the sweep. */
async function assertRetentionPolicy(
  client: Client,
  policy: ReviewRetentionPolicy,
): Promise<void> {
  const result = await client.query<{
    completed_days: number;
    unfinished_days: number;
  }>(
    `SELECT completed_days, unfinished_days FROM public.adaptive_review_retention_policy
     WHERE singleton FOR SHARE`,
  );
  const stored = result.rows[0];
  if (
    !stored ||
    stored.completed_days !== policy.completedDays ||
    stored.unfinished_days !== policy.unfinishedDays
  )
    throw new Error(
      'review retention policy differs from the database policy; use the database values or ask its owner to change the policy explicitly',
    );
}

/** Hold a session lock on the SAME connection used by the Absurd worker. */
export async function withReviewExecution<T>(
  databaseUrl: string,
  queueName: string,
  publish: boolean,
  run: (client: Client) => Promise<T>,
  policy?: ReviewRetentionPolicy,
): Promise<T> {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
  });
  // Connection loss must reject the host, rather than silently lose its lock
  // while a reconnecting pool continues executing work.
  let connectionError: (error: Error) => void = () => undefined;
  const disconnected = new Promise<never>((_resolve, reject) => {
    connectionError = reject;
  });
  // Attach immediately, including while opening/initializing the connection.
  void disconnected.catch(() => undefined);
  client.on('error', connectionError);
  try {
    await client.connect();
    await initialize(client, policy);
    await client.query(
      'SELECT pg_advisory_lock_shared(hashtextextended($1, 0))',
      [queueName],
    );
    await client.query(
      `INSERT INTO public.adaptive_review_retention (queue_name) VALUES ($1)
       ON CONFLICT DO NOTHING`,
      [queueName],
    );
    const record = await client.query<{ expired_at: Date | null }>(
      'SELECT expired_at FROM public.adaptive_review_retention WHERE queue_name = $1',
      [queueName],
    );
    if (record.rows[0].expired_at)
      throw new Error(
        'review execution expired; start a new review with a new execution ID',
      );
    await client.query(
      'UPDATE public.adaptive_review_retention SET last_used_at = clock_timestamp() WHERE queue_name = $1',
      [queueName],
    );
    let completed = false;
    try {
      const result = await Promise.race([run(client), disconnected]);
      completed = true;
      return result;
    } finally {
      await client.query(
        `UPDATE public.adaptive_review_retention
         SET last_used_at = clock_timestamp(), published = published OR $2
         WHERE queue_name = $1`,
        [queueName, publish && completed],
      );
    }
  } finally {
    await client.end(); // Also releases the session lock after worker shutdown.
  }
}

export interface ReviewCleanupResult {
  queueName: string;
  outcome: 'would-expire' | 'expired' | 'active' | 'retained';
}

/** Bounded, oldest-first sweep. Dry run is the default and never changes data. */
export async function cleanupReviewExecutions(args: {
  databaseUrl: string;
  policy?: ReviewRetentionPolicy;
  apply?: boolean;
  limit?: number;
}): Promise<ReviewCleanupResult[]> {
  const policy = args.policy ?? DEFAULT_REVIEW_RETENTION;
  const limit = args.limit ?? 25;
  if (
    ![policy.completedDays, policy.unfinishedDays, limit].every(
      (value) => Number.isSafeInteger(value) && value >= 1 && value <= 36500,
    )
  )
    throw new Error(
      'retention days and batch limit must be positive bounded integers',
    );
  const client = new Client({
    connectionString: args.databaseUrl,
    connectionTimeoutMillis: 5000,
  });
  // pg emits idle connection errors; queries below still fail on a dead client.
  client.on('error', () => undefined);
  const results: ReviewCleanupResult[] = [];
  const eligible = `expired_at IS NULL AND last_used_at < clock_timestamp() -
    make_interval(days => CASE WHEN published THEN $1::int ELSE $2::int END)`;
  try {
    await client.connect();
    const exists = await client.query<{ present: boolean }>(
      "SELECT to_regclass('public.adaptive_review_retention') IS NOT NULL AS present",
    );
    if (!exists.rows[0].present) return results;
    const initialized = await client.query<{ present: boolean }>(
      "SELECT to_regclass('public.adaptive_review_retention_policy') IS NOT NULL AS present",
    );
    if (!initialized.rows[0].present)
      throw new Error(
        'review retention policy is not initialized; run a stage to initialize it before cleanup',
      );
    await assertRetentionPolicy(client, policy);
    const candidates = await client.query<{ queue_name: string }>(
      `SELECT queue_name FROM public.adaptive_review_retention WHERE ${eligible}
       ORDER BY last_used_at, queue_name LIMIT $3`,
      [policy.completedDays, policy.unfinishedDays, limit],
    );
    for (const { queue_name: queueName } of candidates.rows) {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout = '2s'");
        await client.query("SET LOCAL statement_timeout = '15s'");
        await assertRetentionPolicy(client, policy);
        // Nonblocking: running hosts and competing cleanup processes win.
        const lock = await client.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired',
          [queueName],
        );
        let outcome: ReviewCleanupResult['outcome'] = 'active';
        if (lock.rows[0].acquired) {
          // Recheck after locking: a resume may have refreshed the record.
          const stale = await client.query(
            `SELECT 1 FROM public.adaptive_review_retention
             WHERE ${eligible} AND queue_name = $3 FOR UPDATE`,
            [policy.completedDays, policy.unfinishedDays, queueName],
          );
          outcome = stale.rowCount ? 'would-expire' : 'retained';
          if (stale.rowCount && args.apply) {
            // Use the same Absurd function as dropQueue(), on this transaction
            // so dropping both queues and recording expiry is all-or-nothing.
            await client.query('SELECT absurd.drop_queue($1)', [queueName]);
            await client.query('SELECT absurd.drop_queue($1)', [
              `${queueName}-input`,
            ]);
            await client.query(
              `UPDATE public.adaptive_review_retention SET expired_at = clock_timestamp()
               WHERE queue_name = $1`,
              [queueName],
            );
            outcome = 'expired';
          }
        }
        await client.query('COMMIT');
        results.push({ queueName, outcome });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return results;
  } finally {
    await client.end();
  }
}
