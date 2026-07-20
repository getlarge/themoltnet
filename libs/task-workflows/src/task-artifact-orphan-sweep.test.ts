import { describe, expect, it } from 'vitest';

import {
  type OrphanSweepObject,
  parseTaskArtifactObjectKey,
  selectOrphanCandidates,
} from './task-artifact-orphan-sweep.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111101';
const OTHER_TEAM_ID = '22222222-2222-4222-8222-222222222202';
const CID = 'bafkreiabc123';
const TASK_ID = '33333333-3333-4333-8333-333333333303';

describe('parseTaskArtifactObjectKey', () => {
  it('parses a canonical team artifact key', () => {
    const key = `teams/${TEAM_ID}/artifacts/${CID}`;

    const ref = parseTaskArtifactObjectKey(key);

    expect(ref).toEqual({
      teamId: TEAM_ID,
      cid: CID,
      objectKey: key,
    });
  });

  it('rejects runtime-session keys', () => {
    const key = `teams/${TEAM_ID}/runtime-sessions/tasks/${TASK_ID}/attempts/1/abc.jsonl.gz`;

    expect(parseTaskArtifactObjectKey(key)).toBeNull();
  });

  it('rejects keys with an extra trailing segment', () => {
    const key = `teams/${TEAM_ID}/artifacts/${CID}/extra`;

    expect(parseTaskArtifactObjectKey(key)).toBeNull();
  });

  it('rejects keys missing the artifacts segment', () => {
    const key = `teams/${TEAM_ID}/${CID}`;

    expect(parseTaskArtifactObjectKey(key)).toBeNull();
  });

  it('rejects keys whose team id is not a uuid', () => {
    const key = `teams/not-a-uuid/artifacts/${CID}`;

    expect(parseTaskArtifactObjectKey(key)).toBeNull();
  });

  it('rejects keys with an empty cid', () => {
    const key = `teams/${TEAM_ID}/artifacts/`;

    expect(parseTaskArtifactObjectKey(key)).toBeNull();
  });

  it('rejects keys with a trailing slash after the cid', () => {
    const key = `teams/${TEAM_ID}/artifacts/${CID}/`;

    expect(parseTaskArtifactObjectKey(key)).toBeNull();
  });
});

describe('selectOrphanCandidates', () => {
  const cutoff = new Date('2026-07-15T00:00:00.000Z');

  it('includes only parseable keys older than the cutoff', () => {
    const objects: OrphanSweepObject[] = [
      {
        key: `teams/${TEAM_ID}/artifacts/${CID}`,
        lastModified: new Date('2026-07-14T23:59:59.000Z'),
      },
      {
        key: `teams/${OTHER_TEAM_ID}/runtime-sessions/tasks/${TASK_ID}/attempts/1/abc.jsonl.gz`,
        lastModified: new Date('2026-07-01T00:00:00.000Z'),
      },
    ];

    const candidates = selectOrphanCandidates(objects, cutoff);

    expect(candidates).toEqual([
      {
        teamId: TEAM_ID,
        cid: CID,
        objectKey: `teams/${TEAM_ID}/artifacts/${CID}`,
      },
    ]);
  });

  it('skips objects with no lastModified', () => {
    const objects: OrphanSweepObject[] = [
      { key: `teams/${TEAM_ID}/artifacts/${CID}` },
    ];

    expect(selectOrphanCandidates(objects, cutoff)).toEqual([]);
  });

  it('skips objects modified exactly at the cutoff', () => {
    const objects: OrphanSweepObject[] = [
      {
        key: `teams/${TEAM_ID}/artifacts/${CID}`,
        lastModified: new Date(cutoff),
      },
    ];

    expect(selectOrphanCandidates(objects, cutoff)).toEqual([]);
  });

  it('skips objects modified after the cutoff', () => {
    const objects: OrphanSweepObject[] = [
      {
        key: `teams/${TEAM_ID}/artifacts/${CID}`,
        lastModified: new Date('2026-07-15T00:00:01.000Z'),
      },
    ];

    expect(selectOrphanCandidates(objects, cutoff)).toEqual([]);
  });
});
