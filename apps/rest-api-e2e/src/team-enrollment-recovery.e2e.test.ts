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
  type ClaimTeamEnrollment,
  createDatabase,
  runMigrations,
  teamEnrollments,
  teamInvites,
  teams,
} from '@moltnet/database';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestHarness, DATABASE_URL, type TestHarness } from './setup.js';

const root = resolve(import.meta.dirname, '../../..');
const worker = resolve(
  root,
  'apps/rest-api/scripts/team-enrollment-recovery-worker.ts',
);
let harness: TestHarness;
let database: ReturnType<typeof createDatabase>;
let databaseUrl: string;
const databaseName = `enrollment_${randomUUID().replaceAll('-', '')}`;
const children = new Set<ChildProcess>();

function start(input: ClaimTeamEnrollment, pause?: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', worker], {
    cwd: root,
    env: {
      ...process.env,
      ENROLLMENT_TEST_DATABASE_URL: databaseUrl,
      ENROLLMENT_TEST_INPUT: JSON.stringify(input),
      ENROLLMENT_TEST_PAUSE: pause ?? '',
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
    async waitFor(marker: string) {
      const deadline = Date.now() + 60_000;
      while (!output.includes(marker)) {
        if (exited)
          throw new Error(
            `Enrollment worker exited before ${marker}: ${errors}\n${output}`,
          );
        if (Date.now() > deadline)
          throw new Error(
            `Enrollment worker timed out at ${marker}: ${errors}\n${output}`,
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

async function fixture() {
  const [agent] = await database.db
    .insert(agents)
    .values({
      publicKey: `ed25519:${randomUUID()}`,
      fingerprint: randomUUID().slice(0, 19),
    })
    .returning();
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
      maxUses: 1,
      expiresAt: new Date(Date.now() + 120_000),
    })
    .returning();
  return {
    agent,
    team,
    invite,
    input: {
      agentId: agent.id,
      inviteId: invite.id,
      idempotencyHash: 'a'.repeat(64),
      requestHash: 'b'.repeat(64),
    },
  };
}

describe('team enrollment process recovery', () => {
  it('rolls back receipt and invite use when the DBOS claim transaction fails', async () => {
    const { input, invite } = await fixture();
    const failed = start(input, 'rollback');
    await failed.closed;
    expect(failed.child.exitCode).not.toBe(0);
    expect(failed.output()).not.toContain('GRANTED');
    expect(
      await database.db
        .select()
        .from(teamEnrollments)
        .where(eq(teamEnrollments.inviteId, invite.id)),
    ).toEqual([]);
    expect(
      (
        await database.db
          .select()
          .from(teamInvites)
          .where(eq(teamInvites.id, invite.id))
      )[0].useCount,
    ).toBe(0);
  });

  it.each(['claim', 'membership'])(
    'resumes after process death at %s without consuming twice',
    async (point) => {
      const { input, team, invite, agent } = await fixture();
      const first = start(input, point);
      await first.waitFor(`PAUSED:${point}`);
      first.child.kill('SIGKILL');
      await first.closed;
      const [claimed] = await database.db
        .select()
        .from(teamInvites)
        .where(eq(teamInvites.id, invite.id));
      expect(claimed.useCount).toBe(1);
      const [pending] = await database.db
        .select()
        .from(teamEnrollments)
        .where(eq(teamEnrollments.inviteId, invite.id));
      expect(pending.membershipGrantedAt).toBeNull();

      const second = start(input);
      await second.waitFor('RESULT:');
      await second.closed;
      const result = JSON.parse(
        second.output().split('RESULT:')[1].split('\n')[0],
      ) as { ids: string[]; role: string; mismatch: boolean };
      expect(result).toEqual({
        ids: [pending.id, pending.id],
        role: 'member',
        mismatch: true,
      });
      expect((first.output() + second.output()).match(/GRANTED/g)).toHaveLength(
        1,
      );
      const [ready] = await database.db
        .select()
        .from(teamEnrollments)
        .where(eq(teamEnrollments.id, pending.id));
      expect(ready.membershipGrantedAt).not.toBeNull();
      expect(ready.issuedKeyId).toBeNull();
      expect(
        (
          await database.db
            .select()
            .from(teamInvites)
            .where(eq(teamInvites.id, invite.id))
        )[0].useCount,
      ).toBe(1);
      const members = await createRelationshipReader(
        harness.oryClients.relationshipRead,
      ).listTeamMembers(team.id);
      expect(members).toContainEqual({
        subjectId: agent.id,
        subjectNs: 'Agent',
        relation: 'members',
      });
      // Neither workflow input nor any checkpoint needs the raw invite code.
      const checkpoints = await database.db.execute(
        sql`SELECT row_to_json(s)::text AS payload FROM dbos.workflow_status s`,
      );
      expect(JSON.stringify(checkpoints.rows)).not.toContain(invite.code);
    },
  );

  it('preserves an existing owner role while enrolling with a member invite', async () => {
    const { input, team, agent } = await fixture();
    await createRelationshipWriter(
      harness.oryClients.relationship,
      harness.oryClients.relationshipRead,
    ).grantTeamOwners(team.id, agent.id, KetoNamespace.Agent);
    const process = start(input);
    await process.waitFor('RESULT:');
    await process.closed;
    expect(process.output()).not.toContain('GRANTED');
    const [receipt] = await database.db
      .select()
      .from(teamEnrollments)
      .where(eq(teamEnrollments.agentId, agent.id));
    expect(receipt.role).toBe('owner');
  });
});
