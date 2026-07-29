/* eslint-disable no-console */
/**
 * One-time backfill: seed the standard engineering guidance into existing
 * runtime profiles as one ordinary prompt_prefix context entry.
 *
 * This preserves the pre-profile-context workflow for deployed profiles while
 * keeping the resulting guidance profile-owned and revision/CID-addressed.
 * Existing profile context is preserved: the standard entry is appended only
 * when it is not already present.
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
import {
  resolveRuntimeProfileContextRecipe,
  runtimeProfileDefinitionPayload,
} from '@moltnet/tasks';
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
    const candidates: Array<typeof runtimeProfiles.$inferSelect> = [];

    for (const profile of profiles) {
      if (
        !Array.isArray(profile.context) ||
        !profile.context.every(isContextEntry)
      ) {
        throw new Error(`Profile ${profile.id} has invalid context data`);
      }
      if (
        profile.context.some(
          (entry) => entry.slug === STANDARD_ENGINEERING_SLUG,
        )
      ) {
        continue;
      }
      candidates.push(profile);
    }

    console.log(
      `Found ${candidates.length} runtime profiles to backfill${dryRun ? ' (dry run)' : ''}`,
    );

    for (const profile of candidates) {
      const context = [...profile.context, standardContext];
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
        : `Backfill complete. Updated ${candidates.length} profiles.`,
    );
  } finally {
    await pool.end();
  }
}

backfill().catch((error: unknown) => {
  console.error('Backfill failed:', error);
  process.exitCode = 1;
});
