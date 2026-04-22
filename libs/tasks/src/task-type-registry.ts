import { CID } from 'multiformats/cid';
import * as json from 'multiformats/codecs/json';
import { sha256 } from 'multiformats/hashes/sha2';

import { BUILT_IN_TASK_TYPES } from './task-types/index.js';

let schemaCids: Map<string, string> | null = null;

async function computeCid(value: unknown): Promise<string> {
  const bytes = json.encode(value);
  const hash = await sha256.digest(bytes);
  return CID.create(1, json.code, hash).toString();
}

export async function initTaskTypeRegistry(): Promise<void> {
  if (schemaCids) return;
  const entries = await Promise.all(
    Object.entries(BUILT_IN_TASK_TYPES).map(async ([type, entry]) => {
      const cid = await computeCid(entry.inputSchema);
      return [type, cid] as const;
    }),
  );
  schemaCids = new Map(entries);
}

export function getTaskTypeRegistry(): Map<string, string> {
  if (!schemaCids) {
    throw new Error(
      'Task type registry not initialized. Call initTaskTypeRegistry() first.',
    );
  }
  return schemaCids;
}

export const TASK_TYPE_SCHEMA_CIDS = new Proxy({} as Record<string, string>, {
  get(_, prop: string) {
    return getTaskTypeRegistry().get(prop);
  },
});
