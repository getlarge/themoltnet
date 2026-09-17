import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import {
  createRelationshipReader,
  createRelationshipWriter,
  KetoNamespace,
} from '@moltnet/auth';
import {
  agents,
  createDatabase,
  humans,
  runMigrations,
  teamInvites,
  teams,
} from '@moltnet/database';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// eslint-disable-next-line @nx/enforce-module-boundaries -- Input type for the server process fixture.
import type { RedeemTeamInvite } from '../../rest-api/src/workflows/team-invite-workflow.js';
import { createTestHarness, DATABASE_URL, type TestHarness } from './setup.js';

const root = resolve(import.meta.dirname, '../../..');
const worker = resolve(
  root,
  'apps/rest-api-e2e/src/fixtures/team-invite-recovery.worker.ts',
);
let harness: TestHarness;
let database: ReturnType<typeof createDatabase>;
let databaseUrl: string;
const databaseName = `invite_${randomUUID().replaceAll('-', '')}`;
const children = new Set<ChildProcess>();

function start(input: RedeemTeamInvite, pause?: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', worker], {
    cwd: root,
    env: {
      ...process.env,
      INVITE_TEST_DATABASE_URL: databaseUrl,
      INVITE_TEST_INPUT: JSON.stringify(input),
      INVITE_TEST_PAUSE: pause ?? '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let output = '';
  let errors = '';
  let exited = false;
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    errors += chunk.toString();
  });
  const closed = new Promise<void>((resolveClose) => {
    child.once('close', () => {
      exited = true;
      children.delete(child);
      resolveClose();
    });
  });
  return {
    child,
    closed,
    output: () => output,
    errors: () => errors,
    async waitFor(marker: string) {
      const deadline = Date.now() + 60_000;
      while (!output.includes(marker)) {
        if (exited)
          throw new Error(
            `Invite worker exited before ${marker}: ${errors}\n${output}`,
          );
        if (Date.now() > deadline)
          throw new Error(
            `Invite worker timed out at ${marker}: ${errors}\n${output}`,
          );
        await new Promise((resolveWait) => {
          setTimeout(resolveWait, 100);
        });
      }
    },
  };
}

beforeAll(async () => {
  harness = await createTestHarness();
  await harness.db.execute(
    sql`CREATE DATABASE ${sql.identifier(databaseName)}`,
  );
  const url = new URL(DATABASE_URL);
  url.pathname = `/${databaseName}`;
  databaseUrl = url.toString();
  await runMigrations(databaseUrl);
  database = createDatabase(databaseUrl);
});
afterAll(async () => {
  const exits = [...children].map(
    (child) =>
      new Promise<void>((resolveExit) => {
        child.once('close', () => resolveExit());
        child.kill('SIGKILL');
      }),
  );
  await Promise.all(exits);
  await database?.pool.end();
  if (harness) {
    await harness.db.execute(
      sql`DROP DATABASE IF EXISTS ${sql.identifier(databaseName)} WITH (FORCE)`,
    );
    await harness.teardown();
  }
});

async function fixture(subjectNs = KetoNamespace.Agent) {
  const [agent] = await database.db
    .insert(agents)
    .values({
      publicKey: `ed25519:${randomUUID()}`,
      fingerprint: randomUUID().slice(0, 19),
    })
    .returning();
  const subjectId =
    subjectNs === KetoNamespace.Human
      ? (await database.db.insert(humans).values({}).returning())[0].id
      : agent.id;
  const [team] = await database.db
    .insert(teams)
    .values({
      name: 'Recovery test',
      creatorAgentId: agent.id,
      personal: false,
      status: 'active',
    })
    .returning();
  const [invite] = await database.db
    .insert(teamInvites)
    .values({
      teamId: team.id,
      creatorAgentId: agent.id,
      role: 'member',
      code: randomUUID(),

      expiresAt: new Date(Date.now() + 120_000),
    })
    .returning();
  return {
    agent,
    team,
    invite,
    input: {
      subjectId,
      subjectNs,
      inviteId: invite.id,
    },
  };
}

describe('team invitation process recovery', () => {
  it('rolls back the claim and its DBOS checkpoint when the DBOS claim transaction fails', async () => {
    const { input, invite } = await fixture();
    const failed = start(input, 'rollback');
    await failed.closed;
    expect(failed.child.exitCode).not.toBe(0);
    expect(failed.errors()).toContain('injected invite transaction rollback');
    expect(failed.output()).not.toContain('GRANTED');
    expect(
      (
        await database.db
          .select()
          .from(teamInvites)
          .where(eq(teamInvites.id, invite.id))
      )[0].usedAt,
    ).toBeNull();
  });

  it.each([
    [KetoNamespace.Agent, 'claim'],
    [KetoNamespace.Agent, 'membership'],
    [KetoNamespace.Human, 'claim'],
    [KetoNamespace.Human, 'membership'],
  ] as const)(
    'resumes %s membership after process death at %s without consuming twice',
    async (subjectNs, point) => {
      const { input, team, invite } = await fixture(subjectNs);
      const first = start(input, point);
      await first.waitFor(`PAUSED:${point}`);
      first.child.kill('SIGKILL');
      await first.closed;
      const [claimed] = await database.db
        .select()
        .from(teamInvites)
        .where(eq(teamInvites.id, invite.id));
      expect(claimed.usedAt).not.toBeNull();

      const second = start(input);
      await second.waitFor('RESULT:');
      await second.closed;
      const result = JSON.parse(
        second.output().split('RESULT:')[1].split('\n')[0],
      ) as { teams: string[]; role: string; mismatch: boolean };
      expect(result).toEqual({
        teams: [team.id, team.id],
        role: 'member',
        mismatch: true,
      });
      expect((first.output() + second.output()).match(/GRANTED/g)).toHaveLength(
        1,
      );
      const [ready] = await database.db
        .select()
        .from(teamInvites)
        .where(eq(teamInvites.id, invite.id));
      expect(ready.usedAt).toEqual(claimed.usedAt);
      const members = await createRelationshipReader(
        harness.oryClients.relationshipRead,
      ).listTeamMembers(team.id);
      expect(members).toContainEqual({
        subjectId: input.subjectId,
        subjectNs,
        relation: 'members',
      });
      // Neither workflow input nor any checkpoint needs the raw invite code.
      const checkpoints = await database.db.execute(
        sql`SELECT row_to_json(s)::text AS payload FROM dbos.workflow_status s`,
      );
      expect(JSON.stringify(checkpoints.rows)).not.toContain(invite.code);
    },
  );

  it('does not overwrite a role changed to owner before reconciliation', async () => {
    const { input, team, agent } = await fixture();
    await createRelationshipWriter(
      harness.oryClients.relationship,
      harness.oryClients.relationshipRead,
    ).grantTeamOwners(team.id, agent.id, KetoNamespace.Agent);
    const process = start(input);
    await process.waitFor('RESULT:');
    await process.closed;
    expect(process.output()).not.toContain('GRANTED');
    expect(
      (
        JSON.parse(process.output().split('RESULT:')[1].split('\n')[0]) as {
          role: string;
        }
      ).role,
    ).toBe('owner');
  });
});
