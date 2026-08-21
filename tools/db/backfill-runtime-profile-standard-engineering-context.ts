/* eslint-disable no-console */
/**
 * Sync the standard engineering guidance into existing runtime profiles as one
 * ordinary prompt_prefix context entry, keeping deployed profiles current with
 * the catalogue.
 *
 * Idempotent and content-aware: the standard entry is appended to profiles that
 * lack it (seed), and refreshed on profiles whose entry content has drifted from
 * the current catalogue (update) — this is how in-place edits to the
 * standard-engineering recipe reach already-seeded profiles. Profiles already
 * carrying the current content, and all other context entries, are left
 * untouched; the resulting guidance stays profile-owned and revision/CID-addressed.
 *
 * Run from the repo root:
 *   pnpm exec tsx tools/db/backfill-runtime-profile-standard-engineering-context.ts --dry-run
 *   pnpm exec tsx tools/db/backfill-runtime-profile-standard-engineering-context.ts
 *
 * Production via Fly MPG proxy on port 15432:
 *   fly mpg proxy <cluster-id> --local-port 15432
 *   pnpm exec tsx tools/db/backfill-runtime-profile-standard-engineering-context.ts --dry-run
 *   pnpm exec tsx tools/db/backfill-runtime-profile-standard-engineering-context.ts
 */

import { config } from '@dotenvx/dotenvx';
import { computeJsonCid } from '@moltnet/crypto-service';
import { createDatabase, runtimeProfiles } from '@moltnet/database';
import { runtimeProfileDefinitionPayload } from '@moltnet/runtime-profiles';
import { resolveRuntimeProfileContextRecipe } from '@moltnet/tasks';
import { sql } from 'drizzle-orm';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const proxyHost =
  args.find((arg) => arg.startsWith('--host='))?.split('=')[1] ?? 'localhost';
const proxyPort =
  args.find((arg) => arg.startsWith('--port='))?.split('=')[1] ?? '15432';

const STANDARD_ENGINEERING_SLUG = 'standard-engineering-v1';
const STANDARD_ENGINEERING_RECIPE = 'standard-engineering@v1';

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

function loadStandardEngineeringContext(): ContextEntry {
  const fragments = resolveRuntimeProfileContextRecipe(
    STANDARD_ENGINEERING_RECIPE,
  ).map((fragment) => {
    if (fragment.binding !== 'prompt_prefix') {
      throw new Error(
        `Recipe fragment ${fragment.slug} must use prompt_prefix`,
      );
    }
    return fragment.content;
  });

  return {
    slug: STANDARD_ENGINEERING_SLUG,
    binding: 'prompt_prefix',
    content: fragments.join('\n\n'),
  };
}

// The canonical payload lives in @moltnet/tasks so this script, the REST API
// write path, and executor manifest attestation all hash the same shape. Do
// not inline a local copy here — a divergent formula silently writes CIDs the
// API can never reproduce.
function computeProfileDefinitionCid(
  profile: typeof runtimeProfiles.$inferSelect,
  context: ContextEntry[],
): Promise<string> {
  return computeJsonCid(
    runtimeProfileDefinitionPayload({ ...profile, context }),
  );
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

async function backfill(): Promise<void> {
  const { db, pool } = createDatabase(resolveUrl());
  try {
    const profiles = await db.select().from(runtimeProfiles);
    const standardContext = loadStandardEngineeringContext();
    const candidates: Array<{
      profile: typeof runtimeProfiles.$inferSelect;
      action: 'seed' | 'update';
    }> = [];

    for (const profile of profiles) {
      if (
        !Array.isArray(profile.context) ||
        !profile.context.every(isContextEntry)
      ) {
        throw new Error(`Profile ${profile.id} has invalid context data`);
      }
      const existing = profile.context.find(
        (entry) => entry.slug === STANDARD_ENGINEERING_SLUG,
      );
      if (!existing) {
        candidates.push({ profile, action: 'seed' });
      } else if (existing.content !== standardContext.content) {
        // Present but stale — re-sync to the current catalogue content (this is
        // how in-place edits to standard-engineering reach deployed profiles).
        candidates.push({ profile, action: 'update' });
      }
      // else: already present and current — skip.
    }

    console.log(
      `Found ${candidates.length} runtime profiles to sync${dryRun ? ' (dry run)' : ''}`,
    );

    for (const { profile, action } of candidates) {
      const context =
        action === 'seed'
          ? [...profile.context, standardContext]
          : profile.context.map((entry) =>
              entry.slug === STANDARD_ENGINEERING_SLUG
                ? standardContext
                : entry,
            );
      const definitionCid = await computeProfileDefinitionCid(profile, context);
      if (dryRun) {
        console.log(
          `  [dry-run] ${action} ${profile.id} (${profile.name}) → ${definitionCid}`,
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
      console.log(
        `  ${action === 'seed' ? 'Seeded' : 'Updated'} ${profile.id} (${profile.name})`,
      );
    }

    console.log(
      dryRun
        ? `Dry run complete. ${candidates.length} profiles would be synced.`
        : `Sync complete. ${candidates.length} profiles updated.`,
    );
  } finally {
    await pool.end();
  }
}

backfill().catch((error: unknown) => {
  console.error('Backfill failed:', error);
  process.exitCode = 1;
});
