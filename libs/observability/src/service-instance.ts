import { randomUUID } from 'node:crypto';

/**
 * One identity for this process across metrics, traces and the log worker.
 * A restart gets a new ID so cumulative metric series cannot interleave with
 * another process and appear to reset. Pass this ID to workers explicitly.
 */
export const SERVICE_INSTANCE_ID = randomUUID();
