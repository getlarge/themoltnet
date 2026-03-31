/* eslint-disable no-console */
/**
 * One-time backfill: create personal teams for existing agents.
 *
 * Agents registered before the teams feature (PR #537) have no personal
 * team. This script creates one per agent + writes the Keto owner tuple.
 *
 * Run from the repo root so workspace dependencies resolve correctly:
 *   pnpm exec tsx tools/db/backfill-personal-teams.ts --dry-run
 *   pnpm exec tsx tools/db/backfill-personal-teams.ts
 *
 * Usage (prod via Fly MPG proxy on port 15432):
 *   fly mpg proxy <cluster-id> --local-port 15432
 *   pnpm exec tsx tools/db/backfill-personal-teams.ts --dry-run
 *   pnpm exec tsx tools/db/backfill-personal-teams.ts
 *
 * The script loads .env via dotenvx and rewrites DATABASE_URL to point
 * at localhost:15432 (fly mpg proxy). Override with --port and --host.
 *
 * Requires ORY_PROJECT_URL + ORY_PROJECT_API_KEY for Keto writes.
 *
 * Phases:
 * 1. Query all agents from agent_keys
 * 2. For each without a personal team: create team in DB + Keto tuple
 * 3. Verify all Keto tuples exist
 *
 * Idempotent: checks for existing personal team before creating.
 */

import { config } from '@dotenvx/dotenvx';
import { createDatabase, createTeamRepository } from '@moltnet/database';
import { sql } from 'drizzle-orm';

// ── Parse args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const proxyHost =
  args.find((a) => a.startsWith('--host='))?.split('=')[1] ?? 'localhost';
const proxyPort =
  args.find((a) => a.startsWith('--port='))?.split('=')[1] ?? '15432';

// ── Resolve DATABASE_URL ─────────────────────────────────────────────────────

function resolveUrl(): string {
  const explicit = process.env.DATABASE_URL;
  if (explicit && !explicit.startsWith('encrypted:')) {
    console.log('Using DATABASE_URL from environment');
    return explicit;
  }

  config({ path: ['.env', 'env.public'], override: true });

  const decrypted = process.env.DATABASE_URL;
  if (!decrypted) {
    console.error('DATABASE_URL not found after dotenvx decryption');
    process.exit(1);
  }

  if (decrypted.startsWith('encrypted:')) {
    console.error('DATABASE_URL is still encrypted — check DOTENV_PRIVATE_KEY');
    process.exit(1);
  }

  const url = new URL(decrypted);
  url.hostname = proxyHost;
  url.port = proxyPort;
  url.searchParams.set('sslmode', 'disable');

  const rewritten = url.toString();
  console.log(
    `Rewritten DATABASE_URL: ${url.hostname}:${url.port}/${url.pathname.slice(1)}`,
  );
  return rewritten;
}

// ── Resolve Ory/Keto config ──────────────────────────────────────────────────

function resolveOry(): { url: string; headers: Record<string, string> } {
  const oryUrl = process.env.ORY_PROJECT_URL;
  const apiKey = process.env.ORY_PROJECT_API_KEY ?? process.env.ORY_API_KEY;

  if (!oryUrl || !apiKey) {
    console.error(
      'ORY_PROJECT_URL and ORY_PROJECT_API_KEY are required (loaded from env.public + .env)',
    );
    process.exit(1);
  }

  return {
    url: oryUrl,
    headers: { Authorization: `Bearer ${apiKey}` },
  };
}

// ── Keto helpers ─────────────────────────────────────────────────────────────

async function grantTeamOwner(
  ory: ReturnType<typeof resolveOry>,
  teamId: string,
  subjectId: string,
): Promise<void> {
  const res = await fetch(`${ory.url}/admin/relation-tuples`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...ory.headers },
    body: JSON.stringify({
      namespace: 'Team',
      object: teamId,
      relation: 'owner',
      subject_set: {
        namespace: 'Agent',
        object: subjectId,
        relation: '',
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Keto grant failed: ${res.status} ${await res.text()}`);
  }
}

async function verifyTeamOwner(
  ory: ReturnType<typeof resolveOry>,
  teamId: string,
  subjectId: string,
): Promise<boolean> {
  const params = new URLSearchParams({
    namespace: 'Team',
    object: teamId,
    relation: 'owner',
    'subject_set.namespace': 'Agent',
    'subject_set.object': subjectId,
    'subject_set.relation': '',
  });
  const res = await fetch(`${ory.url}/relation-tuples?${params.toString()}`, {
    headers: ory.headers,
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { relation_tuples?: unknown[] };
  return (data.relation_tuples?.length ?? 0) > 0;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const databaseUrl = resolveUrl();
  const ory = resolveOry();
  const { db, pool } = createDatabase(databaseUrl);
  const teamRepo = createTeamRepository(db);

  console.log(`\nBackfill personal teams${dryRun ? ' (DRY RUN)' : ''}\n`);

  try {
    // 1. Get all agents
    const result = await db.execute<{
      identity_id: string;
      fingerprint: string;
    }>(sql`SELECT identity_id, fingerprint FROM agent_keys`);
    const agents = result.rows;
    console.log(`Found ${agents.length} agents`);

    // 2. Check which already have personal teams
    const needsTeam: Array<{ identityId: string; fingerprint: string }> = [];

    for (const agent of agents) {
      const existing = await teamRepo.findPersonalByCreator(agent.identity_id);
      if (existing) {
        console.log(`  skip ${agent.fingerprint} — has team ${existing.id}`);
      } else {
        needsTeam.push({
          identityId: agent.identity_id,
          fingerprint: agent.fingerprint,
        });
      }
    }

    console.log(`\n${needsTeam.length} agents need personal teams\n`);

    if (dryRun) {
      for (const agent of needsTeam) {
        console.log(`  [dry-run] would create team for ${agent.fingerprint}`);
      }
      console.log(
        `\nDry run complete. ${needsTeam.length} teams would be created.`,
      );
      return;
    }

    // 3. Create teams + Keto tuples
    const created: Array<{ identityId: string; teamId: string }> = [];

    for (const agent of needsTeam) {
      try {
        const team = await teamRepo.create({
          name: agent.fingerprint,
          personal: true,
          createdBy: agent.identityId,
          status: 'active',
        });
        await grantTeamOwner(ory, team.id, agent.identityId);
        created.push({ identityId: agent.identityId, teamId: team.id });
        console.log(`  created team ${team.id} for ${agent.fingerprint}`);
      } catch (err) {
        console.error(`  FAILED ${agent.fingerprint}: ${err}`);
      }
    }

    // 4. Verify Keto tuples
    console.log(`\nVerifying ${created.length} Keto tuples...`);
    let verified = 0;
    let verifyFailed = 0;

    for (const item of created) {
      const ok = await verifyTeamOwner(ory, item.teamId, item.identityId);
      if (ok) {
        verified++;
      } else {
        console.error(
          `  ✗ Team:${item.teamId}#owner@Agent:${item.identityId} not found`,
        );
        verifyFailed++;
      }
    }

    console.log(
      `\nDone. Created: ${created.length}, Verified: ${verified}, Failed: ${verifyFailed}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
