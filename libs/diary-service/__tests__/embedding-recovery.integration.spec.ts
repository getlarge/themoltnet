import { type ChildProcess, fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import {
  agents,
  createDatabase,
  diaries,
  runMigrations,
  teams,
} from '@moltnet/database';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const fixture = fileURLToPath(
  new URL('./fixtures/embedding-recovery-worker.ts', import.meta.url),
);

describe('background embeddings (process recovery)', () => {
  let databaseUrl: string;
  let database: ReturnType<typeof createDatabase>;
  let stopContainer: () => Promise<void>;
  const agentId = '00000000-0000-4000-a000-000000000001';
  const teamId = '00000000-0000-4000-b000-000000000001';
  const diaryId = '00000000-0000-4000-c000-000000000001';

  beforeAll(async () => {
    const container = await new PostgreSqlContainer(
      'pgvector/pgvector:pg16',
    ).start();
    databaseUrl = container.getConnectionUri();
    stopContainer = () => container.stop().then(() => undefined);
    await runMigrations(databaseUrl);
    database = createDatabase(databaseUrl);
    await database.db.insert(agents).values({
      id: agentId,
      identityId: agentId,
      publicKey: 'ed25519:recovery-test',
      fingerprint: 'TEST-RECO-VERY-0001',
    });
    await database.db
      .insert(teams)
      .values({ id: teamId, name: 'Recovery test', creatorAgentId: agentId });
    await database.db.insert(diaries).values({
      id: diaryId,
      teamId,
      name: 'Recovery test',
      creatorAgentId: agentId,
    });
    await database.pool.query(
      'CREATE TABLE recovery_effects (kind text, id text, PRIMARY KEY (kind, id))',
    );
  }, 60000);

  afterAll(async () => {
    await database?.pool.end();
    await stopContainer?.();
  });

  function launch(testCase: string, hold = '') {
    const events = new Set<unknown>();
    const child = fork(fixture, [], {
      execArgv: ['--import', 'tsx'],
      env: {
        ...process.env,
        RECOVERY_DATABASE_URL: databaseUrl,
        RECOVERY_DIARY_ID: diaryId,
        RECOVERY_AGENT_ID: agentId,
        RECOVERY_CASE: testCase,
        RECOVERY_HOLD: hold,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let output = '';
    child.stdout?.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('message', (event) => events.add(event));
    return { child, events, output: () => output };
  }

  async function kill(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }

  it.each(['relation', 'inference', 'failure'])(
    'survives process replacement at %s without losing acknowledged work',
    async (hold) => {
      await database.pool.query('DELETE FROM diary_entries');
      await database.pool.query('TRUNCATE recovery_effects');
      const first = launch(hold, hold);
      let second: ReturnType<typeof launch> | undefined;
      try {
        await expect
          .poll(
            () => {
              if (first.child.exitCode !== null)
                throw new Error(first.output());
              return first.events.has(
                hold === 'relation' ? 'relation' : 'created',
              );
            },
            { timeout: 20000 },
          )
          .toBe(true);
        if (hold === 'inference') {
          await expect
            .poll(() => first.events.has('inference'), { timeout: 10000 })
            .toBe(true);
        }
        if (hold === 'failure') {
          await expect
            .poll(
              async () => {
                const rows = await database.pool.query(
                  "SELECT count(*) FROM dbos.workflow_status WHERE status = 'DELAYED'",
                );
                return Number(rows.rows[0].count);
              },
              { timeout: 10000 },
            )
            .toBe(1);
        }
        await kill(first.child);
        second = launch(hold);
        await expect
          .poll(
            async () => {
              if (second!.child.exitCode !== null)
                throw new Error(second!.output());
              const rows = await database.pool.query(
                'SELECT embedding IS NOT NULL AS ready FROM diary_entries',
              );
              return rows.rows.length === 1 && rows.rows[0].ready;
            },
            { timeout: 20000 },
          )
          .toBe(true);
        const effects = await database.pool.query(
          "SELECT count(*) FROM recovery_effects WHERE kind = 'relation'",
        );
        expect(Number(effects.rows[0].count)).toBe(1);
        await expect
          .poll(async () =>
            Number(
              (
                await database.pool.query(
                  "SELECT count(*) FROM dbos.workflow_status WHERE status IN ('PENDING','ENQUEUED','DELAYED')",
                )
              ).rows[0].count,
            ),
          )
          .toBe(0);
      } finally {
        await kill(first.child);
        if (second) await kill(second.child);
      }
    },
    60000,
  );
});
