import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { computeJsonCid } from '@moltnet/crypto-service';
import { createDatabase, runtimeProfiles } from '@moltnet/database';
import {
  type RuntimeProfileDefinitionV2Input,
  runtimeProfileDefinitionV2Payload,
} from '@moltnet/tasks';
import { eq } from 'drizzle-orm';

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
  const plans = await Promise.all(
    rows.map(async (row) => {
      const sandbox = { ...(row.sandbox as Record<string, unknown>) };
      const legacyProvisioning = {
        snapshot: sandbox.snapshot,
        resumeCommands: sandbox.resumeCommands,
      };
      delete sandbox.snapshot;
      delete sandbox.resumeCommands;
      const requiredExecutables =
        row.requiredExecutables.length > 0
          ? row.requiredExecutables
          : row.requiredTools;
      const requiredTools =
        row.requiredExecutables.length > 0 ? row.requiredTools : [];
      const next = {
        ...row,
        sandbox,
        requiredTools,
        requiredExecutables,
      };
      const definitionCid = await computeJsonCid(
        runtimeProfileDefinitionV2Payload(
          next as unknown as RuntimeProfileDefinitionV2Input,
        ),
      );
      return {
        row,
        next,
        legacyProvisioning,
        definitionCid,
        changed:
          definitionCid !== row.definitionCid ||
          legacyProvisioning.snapshot !== undefined ||
          legacyProvisioning.resumeCommands !== undefined ||
          requiredTools.length !== row.requiredTools.length ||
          requiredExecutables.length !== row.requiredExecutables.length,
      };
    }),
  );
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
      await writeFile(
        resolve(exportPath),
        JSON.stringify(
          plans.map((plan) => ({
            id: plan.row.id,
            name: plan.row.name,
            definitionCid: plan.row.definitionCid,
            requiredTools: plan.row.requiredTools,
            requiredExecutables: plan.row.requiredExecutables,
            provisioning: plan.legacyProvisioning,
          })),
          null,
          2,
        ),
        { mode: 0o600 },
      );
    }
    await db.transaction(async (tx) => {
      for (const plan of changed) {
        await tx
          .update(runtimeProfiles)
          .set({
            sandbox: plan.next.sandbox,
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
