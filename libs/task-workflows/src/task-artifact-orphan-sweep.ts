/**
 * Pure helpers for the task-artifact orphan-object sweep.
 *
 * Staged input artifacts are written to object storage without a metadata
 * row (see stageTaskArtifact); rows appear only when a task creation binds
 * the CID. Objects that never get bound must be garbage-collected. These
 * helpers select deletion candidates from a storage listing; the workflow
 * side (apps/rest-api maintenance) owns listing, row lookups, and deletes.
 */

export interface TaskArtifactObjectRef {
  teamId: string;
  cid: string;
  objectKey: string;
}

export interface OrphanSweepObject {
  key: string;
  lastModified?: Date;
}

const TASK_ARTIFACT_OBJECT_KEY_PATTERN =
  /^teams\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/artifacts\/([A-Za-z0-9]+)$/;

/**
 * Parse a storage key of the canonical task-artifact shape
 * `teams/{teamId}/artifacts/{cid}`. Returns null for any other shape —
 * including runtime-session keys (`teams/{id}/runtime-sessions/...`) —
 * so the sweep can never delete objects it does not own, even if a
 * deployment points multiple stores at one bucket.
 */
export function parseTaskArtifactObjectKey(
  key: string,
): TaskArtifactObjectRef | null {
  const match = TASK_ARTIFACT_OBJECT_KEY_PATTERN.exec(key);
  if (!match) return null;
  return { teamId: match[1], cid: match[2], objectKey: key };
}

/**
 * Select objects old enough to sweep: parseable task-artifact keys whose
 * lastModified is before the grace cutoff. Objects without a lastModified
 * are skipped — better to leak until the next listing reports one than to
 * delete bytes that may have just been staged.
 */
export function selectOrphanCandidates(
  objects: OrphanSweepObject[],
  graceCutoff: Date,
): TaskArtifactObjectRef[] {
  const candidates: TaskArtifactObjectRef[] = [];
  for (const object of objects) {
    if (!object.lastModified || object.lastModified >= graceCutoff) continue;
    const ref = parseTaskArtifactObjectKey(object.key);
    if (ref) candidates.push(ref);
  }
  return candidates;
}
