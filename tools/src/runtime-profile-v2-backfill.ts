import { computeJsonCid } from '@moltnet/crypto-service';
import type { RuntimeProfile } from '@moltnet/database';
import {
  type RuntimeProfileDefinitionV2Input,
  runtimeProfileDefinitionV2Payload,
} from '@moltnet/tasks';

export interface RuntimeProfileV2BackfillPlan {
  row: RuntimeProfile;
  next: RuntimeProfile;
  legacyProvisioning: {
    snapshot: unknown;
    resumeCommands: unknown;
  };
  definitionCid: string;
  changed: boolean;
}

export async function planRuntimeProfileV2Backfill(
  row: RuntimeProfile,
): Promise<RuntimeProfileV2BackfillPlan> {
  if (row.definitionVersion === 2) {
    return {
      row,
      next: row,
      legacyProvisioning: {
        snapshot: undefined,
        resumeCommands: undefined,
      },
      definitionCid: row.definitionCid,
      changed: false,
    };
  }

  const sandbox = { ...(row.sandbox as Record<string, unknown>) };
  const legacyProvisioning = {
    snapshot: sandbox.snapshot,
    resumeCommands: sandbox.resumeCommands,
  };
  delete sandbox.snapshot;
  delete sandbox.resumeCommands;

  // Before v2, requiredTools meant host/guest executables and the daemon
  // validated every entry on PATH. Preserve that meaning during migration.
  const next: RuntimeProfile = {
    ...row,
    definitionVersion: 2,
    sandbox,
    requiredTools: [],
    requiredExecutables: row.requiredTools,
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
    changed: true,
  };
}

export function verifyRuntimeProfileExport(
  value: unknown,
  expectedRows: readonly RuntimeProfile[],
): void {
  if (!Array.isArray(value) || value.length !== expectedRows.length) {
    throw new Error('Runtime profile export verification failed: row count');
  }
  const expectedIds = new Set(expectedRows.map((row) => row.id));
  if (
    value.some(
      (entry) =>
        typeof entry !== 'object' ||
        entry === null ||
        !expectedIds.delete((entry as { id?: unknown }).id as string),
    ) ||
    expectedIds.size > 0
  ) {
    throw new Error('Runtime profile export verification failed: profile ids');
  }
}
