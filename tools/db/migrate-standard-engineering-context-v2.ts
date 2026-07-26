/* eslint-disable no-console */
/**
 * One-time migration: upgrade profiles seeded with the standard-engineering v1
 * context entry to the hardened v2 wording (task-relevant, inspected, redacted
 * uploads — never secrets or PII).
 *
 * The original backfill (backfill-runtime-profile-standard-engineering-context.ts)
 * seeded a single `standard-engineering-v1` prompt_prefix entry whose content is
 * the joined v1 fragments. This migration replaces that entry in place with a
 * `standard-engineering-v2` entry (joined v2 fragments), preserving its position
 * and every other context entry, and bumping revision + definition CID. Profiles
 * that already carry `standard-engineering-v2`, or never carried the v1 entry,
 * are skipped, so the run is idempotent.
 *
 * Scope: this targets the backfilled concatenated entry. Profiles that applied
 * individual fragments through the console picker (e.g. a standalone
 * `verification-and-artifacts-v1` entry) are left untouched — an operator can
 * re-apply `standard-engineering@v2` from the picker.
 *
 * Run from the repo root:
 *   pnpm exec tsx tools/db/migrate-standard-engineering-context-v2.ts --dry-run
 *   pnpm exec tsx tools/db/migrate-standard-engineering-context-v2.ts
 *
 * Production via Fly MPG proxy on port 15432:
 *   fly mpg proxy <cluster-id> --local-port 15432
 *   pnpm exec tsx tools/db/migrate-standard-engineering-context-v2.ts --dry-run
 *   pnpm exec tsx tools/db/migrate-standard-engineering-context-v2.ts
 */

import { config } from '@dotenvx/dotenvx';
import { computeJsonCid } from '@moltnet/crypto-service';
import { createDatabase, runtimeProfiles } from '@moltnet/database';
import { resolveRuntimeProfileContextRecipe } from '@moltnet/tasks';
import { sql } from 'drizzle-orm';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const proxyHost =
  args.find((arg) => arg.startsWith('--host='))?.split('=')[1] ?? 'localhost';
const proxyPort =
  args.find((arg) => arg.startsWith('--port='))?.split('=')[1] ?? '15432';

const OLD_SLUG = 'standard-engineering-v1';
const NEW_SLUG = 'standard-engineering-v2';
const NEW_RECIPE = 'standard-engineering@v2';

type ContextEntry = {
  slug: string;
  binding: 'skill' | 'context_inline' | 'prompt_prefix' | 'user_inline';
  content: string;
};

function resolveUrl(): string {
  const explicit = process.env.DATABASE_URL;
  if (explicit && !explicit.startsWith('encrypted:')) {
    console.log('Using DATABASE_URL from environment');
    return explicit;
  }

  config({ path: ['env.public', '.env.infra.local'], override: false });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL not found after dotenvx decryption');
  }
  if (databaseUrl.startsWith('encrypted:')) {
    throw new Error('DATABASE_URL is still encrypted - check .env.infra.local');
  }

  const url = new URL(databaseUrl);
  url.hostname = proxyHost;
  url.port = proxyPort;
  url.searchParams.set('sslmode', 'disable');
  console.log(
    `Rewritten DATABASE_URL: ${url.hostname}:${url.port}/${url.pathname.slice(1)}`,
  );
  return url.toString();
}

function buildStandardEngineeringV2Entry(): ContextEntry {
  const content = resolveRuntimeProfileContextRecipe(NEW_RECIPE)
    .map((fragment) => {
      if (fragment.binding !== 'prompt_prefix') {
        throw new Error(
          `Recipe fragment ${fragment.slug} must use prompt_prefix`,
        );
      }
      return fragment.content;
    })
    .join('\n\n');

  return { slug: NEW_SLUG, binding: 'prompt_prefix', content };
}

function normalizeList(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function computeProfileDefinitionCid(
  profile: typeof runtimeProfiles.$inferSelect,
  context: ContextEntry[],
): Promise<string> {
  return computeJsonCid({
    v: 'moltnet:runtime-profile:v1',
    name: profile.name,
    description: profile.description ?? null,
    provider: profile.provider.toLowerCase(),
    model: profile.model.toLowerCase(),
    thinkingLevel: profile.thinkingLevel ?? null,
    temperature: profile.temperature ?? null,
    topP: profile.topP ?? null,
    topK: profile.topK ?? null,
    maxOutputTokens: profile.maxOutputTokens ?? null,
    runtimeKind: profile.runtimeKind,
    sandbox: profile.sandbox,
    sessionStorageMode: profile.sessionStorageMode,
    workspaceStorageMode: profile.workspaceStorageMode,
    defaultWorkspaceMode: profile.defaultWorkspaceMode ?? null,
    allowedWorkspaceModes: [...profile.allowedWorkspaceModes].sort(),
    sessionTtlSec: profile.sessionTtlSec,
    workspaceTtlSec: profile.workspaceTtlSec,
    leaseTtlSec: profile.leaseTtlSec,
    heartbeatIntervalMs: profile.heartbeatIntervalMs,
    maxBatchSize: profile.maxBatchSize,
    maxTurns: profile.maxTurns,
    maxBashTimeouts: profile.maxBashTimeouts,
    requiredEnv: normalizeList(profile.requiredEnv).sort(),
    requiredTools: normalizeList(profile.requiredTools).sort(),
    context,
  });
}

function isContextEntry(value: unknown): value is ContextEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { slug?: unknown }).slug === 'string' &&
    typeof (value as { binding?: unknown }).binding === 'string' &&
    typeof (value as { content?: unknown }).content === 'string'
  );
}

async function migrate(): Promise<void> {
  const { db, pool } = createDatabase(resolveUrl());
  try {
    const profiles = await db.select().from(runtimeProfiles);
    const v2Entry = buildStandardEngineeringV2Entry();
    const candidates: Array<typeof runtimeProfiles.$inferSelect> = [];

    for (const profile of profiles) {
      if (
        !Array.isArray(profile.context) ||
        !profile.context.every(isContextEntry)
      ) {
        throw new Error(`Profile ${profile.id} has invalid context data`);
      }
      if (profile.context.some((entry) => entry.slug === NEW_SLUG)) {
        continue; // already migrated
      }
      if (!profile.context.some((entry) => entry.slug === OLD_SLUG)) {
        continue; // never carried the v1 backfill entry
      }
      candidates.push(profile);
    }

    console.log(
      `Found ${candidates.length} runtime profiles to migrate to ${NEW_SLUG}${dryRun ? ' (dry run)' : ''}`,
    );

    for (const profile of candidates) {
      const context = profile.context.map((entry) =>
        entry.slug === OLD_SLUG ? v2Entry : entry,
      );
      const definitionCid = await computeProfileDefinitionCid(profile, context);
      if (dryRun) {
        console.log(
          `  [dry-run] ${profile.id} (${profile.name}) → ${definitionCid}`,
        );
        continue;
      }
      await db
        .update(runtimeProfiles)
        .set({
          context,
          definitionCid,
          revision: sql`${runtimeProfiles.revision} + 1`,
          updatedAt: sql`now()`,
        })
        .where(sql`${runtimeProfiles.id} = ${profile.id}`);
      console.log(`  Updated ${profile.id} (${profile.name})`);
    }

    console.log(
      dryRun
        ? `Dry run complete. ${candidates.length} profiles would be updated.`
        : `Migration complete. Updated ${candidates.length} profiles.`,
    );
  } finally {
    await pool.end();
  }
}

migrate().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
