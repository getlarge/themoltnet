import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createDatabase, runtimeProfiles } from '@moltnet/database';
import { eq } from 'drizzle-orm';

import {
  planRuntimeProfileV2Backfill,
  verifyRuntimeProfileExport,
} from './runtime-profile-v2-backfill.js';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const exportIndex = process.argv.indexOf('--export');
const exportPath =
  exportIndex >= 0 ? process.argv[exportIndex + 1]?.trim() : undefined;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error('DATABASE_URL is required');

const { db, pool } = createDatabase(databaseUrl);
try {
  const rows = await db.select().from(runtimeProfiles);
  const plans = await Promise.all(rows.map(planRuntimeProfileV2Backfill));
  const changed = plans.filter((plan) => plan.changed);
  const hasProvisioning = plans.some(
    (plan) =>
      plan.legacyProvisioning.snapshot !== undefined ||
      plan.legacyProvisioning.resumeCommands !== undefined,
  );

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        profiles: rows.length,
        changes: changed.map((plan) => ({
          id: plan.row.id,
          name: plan.row.name,
          fromDefinitionCid: plan.row.definitionCid,
          toDefinitionCid: plan.definitionCid,
          requiredTools: plan.next.requiredTools,
          requiredExecutables: plan.next.requiredExecutables,
          hasLegacyProvisioning:
            plan.legacyProvisioning.snapshot !== undefined ||
            plan.legacyProvisioning.resumeCommands !== undefined,
        })),
      },
      null,
      2,
    ),
  );

  if (!apply) process.exitCode = changed.length > 0 ? 2 : 0;
  if (apply) {
    if (hasProvisioning && !exportPath) {
      throw new Error(
        '--export <path> is required before removing legacy snapshot/resume provisioning',
      );
    }
    if (exportPath) {
      const resolvedExportPath = resolve(exportPath);
      const exportedProfiles = plans.map((plan) => ({
        id: plan.row.id,
        name: plan.row.name,
        definitionVersion: plan.row.definitionVersion,
        definitionCid: plan.row.definitionCid,
        requiredTools: plan.row.requiredTools,
        requiredExecutables: plan.row.requiredExecutables,
        provisioning: plan.legacyProvisioning,
      }));
      await writeFile(
        resolvedExportPath,
        JSON.stringify(exportedProfiles, null, 2),
        { mode: 0o600 },
      );
      const persistedExport = JSON.parse(
        await readFile(resolvedExportPath, 'utf8'),
      ) as unknown;
      verifyRuntimeProfileExport(persistedExport, rows);
    }
    await db.transaction(async (tx) => {
      for (const plan of changed) {
        await tx
          .update(runtimeProfiles)
          .set({
            sandbox: plan.next.sandbox,
            definitionVersion: 2,
            requiredTools: plan.next.requiredTools,
            requiredExecutables: plan.next.requiredExecutables,
            definitionCid: plan.definitionCid,
            revision: plan.row.revision + 1,
            updatedAt: new Date(),
          })
          .where(eq(runtimeProfiles.id, plan.row.id));
      }
    });
  }
} finally {
  await pool.end();
}
