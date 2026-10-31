/**
 * E2E: Durable runtime stores
 *
 * Exercises the pi-durable.v1 store contract against the Docker stack and its
 * object store: writer leases, ID minting, ordered idempotent commits, NDJSON
 * reads, and attempt/team authorization.
 */

import { randomUUID } from 'node:crypto';

import {
  appendRuntimeStoreCommit,
  type Client,
  createClient,
  getRuntimeStoreForAttempt,
  listRuntimeStoreCommits,
  mintRuntimeStoreId,
  openRuntimeStore,
  releaseRuntimeStore,
  renewRuntimeStore,
  taskHeartbeat,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  claimPinnedAttempt,
  DEFAULT_LEASE_TTL_SEC,
  type PinnedClaim,
} from './durable-claims.js';
import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

/** Claim lease short enough to wait out the writer lease it caps. */
const SHORT_CLAIM_TTL_SEC = 5;

describe('Durable runtime stores API', () => {
  let harness: TestHarness;
  let client: Client;
  let owner: TestAgent;
  let outsider: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });
    [owner, outsider] = await Promise.all([
      createAgent({
        baseUrl: harness.baseUrl,
        db: harness.db,
        bootstrapIdentityId: harness.bootstrapIdentityId,
      }),
      createAgent({
        baseUrl: harness.baseUrl,
        db: harness.db,
        bootstrapIdentityId: harness.bootstrapIdentityId,
      }),
    ]);
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  const team = () => ({ 'x-moltnet-team-id': owner.personalTeamId });
  const claim = (options?: { leaseTtlSec?: number }) =>
    claimPinnedAttempt(client, owner, 'runtime-stores', options);
  type Writer = PinnedClaim & { writerToken: string };

  async function open(authority: PinnedClaim) {
    const opened = await openRuntimeStore({
      client,
      auth: () => owner.accessToken,
      headers: team(),
      body: authority,
    });
    expect(opened.error).toBeUndefined();
    return opened.data!;
  }

  function append(
    storeId: string,
    writer: Writer,
    body: {
      commitId: string;
      expectedSeq: number;
      writes: Record<string, unknown>[];
    },
    accessToken = owner.accessToken,
  ) {
    return appendRuntimeStoreCommit({
      client,
      auth: () => accessToken,
      headers: team(),
      path: { storeId },
      body: { ...writer, ...body },
    });
  }

  function mint(
    storeId: string,
    writer: Writer,
    accessToken = owner.accessToken,
  ) {
    return mintRuntimeStoreId({
      client,
      auth: () => accessToken,
      headers: team(),
      path: { storeId },
      body: writer,
    });
  }

  const emptyCommit = (expectedSeq: number) => ({
    commitId: randomUUID(),
    expectedSeq,
    writes: [],
  });

  async function readCommits(
    storeId: string,
    query: { afterSeq?: number; limit?: number },
    accessToken = owner.accessToken,
  ) {
    const response = await listRuntimeStoreCommits({
      client,
      auth: () => accessToken,
      headers: team(),
      path: { storeId },
      query,
      parseAs: 'text',
    });
    if (response.error !== undefined)
      return { status: response.response?.status };
    const [header, ...lines] = (response.data as unknown as string)
      .split('\n')
      .filter(Boolean)
      .map(
        (line) => JSON.parse(line) as Record<string, unknown> & { seq: number },
      );
    return { status: response.response?.status, header, commits: lines };
  }

  it('binds a store to the attempt and appends ordered, idempotent commits', async () => {
    const authority = await claim();
    const attemptQuery = {
      taskId: authority.taskId,
      attemptN: authority.attemptN,
    };

    const before = await getRuntimeStoreForAttempt({
      client,
      auth: () => owner.accessToken,
      headers: team(),
      query: attemptQuery,
    });
    expect(before.error).toBeUndefined();
    expect(before.data).toBeNull();

    const handle = await open(authority);
    expect(handle).toMatchObject({ format: 'pi-durable.v1', headSeq: 0 });
    const writer = { ...authority, writerToken: handle.writerToken };

    const ids: number[] = [];
    for (let i = 0; i < 2; i++) {
      const minted = await mintRuntimeStoreId({
        client,
        auth: () => owner.accessToken,
        headers: team(),
        path: { storeId: handle.storeId },
        body: writer,
      });
      expect(minted.error).toBeUndefined();
      ids.push(minted.data!.id);
    }
    expect(ids[1]).toBeGreaterThan(ids[0]);

    const first = {
      commitId: randomUUID(),
      expectedSeq: 0,
      writes: [{ type: 'conversation', value: { id: ids[0] } }],
    };
    const appendedId = ids[1] + 100;
    const second = {
      commitId: randomUUID(),
      expectedSeq: 1,
      writes: [{ type: 'conversation', value: { id: appendedId } }],
    };
    expect((await append(handle.storeId, writer, first)).data).toEqual({
      seq: 1,
    });
    expect((await append(handle.storeId, writer, second)).data).toEqual({
      seq: 2,
    });

    // A lost acknowledgment is retried with the same commit ID and payload.
    const replay = await append(handle.storeId, writer, first);
    expect(replay.error).toBeUndefined();
    expect(replay.data).toEqual({ seq: 1 });

    const reusedId = await append(handle.storeId, writer, {
      ...first,
      writes: [{ type: 'conversation', value: { id: 999 } }],
    });
    expect(reusedId.response?.status).toBe(409);

    const staleHead = await append(handle.storeId, writer, {
      commitId: randomUUID(),
      expectedSeq: 1,
      writes: [],
    });
    expect(staleHead.response?.status).toBe(409);

    // Appended IDs advance the allocator past every written record.
    const next = await mintRuntimeStoreId({
      client,
      auth: () => owner.accessToken,
      headers: team(),
      path: { storeId: handle.storeId },
      body: writer,
    });
    expect(next.error).toBeUndefined();
    expect(next.data!.id).toBeGreaterThan(appendedId);

    const all = await readCommits(handle.storeId, {});
    expect(all.status).toBe(200);
    expect(all.header).toEqual({ headSeq: 2, count: 2 });
    expect(all.commits).toEqual([
      expect.objectContaining({
        seq: 1,
        commitId: first.commitId,
        writes: first.writes,
      }),
      expect.objectContaining({
        seq: 2,
        commitId: second.commitId,
        writes: second.writes,
      }),
    ]);

    expect(all.commits![0].sha256).toMatch(/^[0-9a-f]{64}$/);

    const page = await readCommits(handle.storeId, { afterSeq: 1, limit: 1 });
    expect(page.header).toEqual({ headSeq: 2, count: 1 });
    expect(page.commits!.map((commit) => commit.seq)).toEqual([2]);

    const after = await getRuntimeStoreForAttempt({
      client,
      auth: () => owner.accessToken,
      headers: team(),
      query: attemptQuery,
    });
    expect(after.data).toEqual({
      storeId: handle.storeId,
      format: 'pi-durable.v1',
      headSeq: 2,
    });
  });

  it('holds one writer lease until it is released', async () => {
    const authority = await claim();
    const handle = await open(authority);
    const writer = { ...authority, writerToken: handle.writerToken };

    const contended = await openRuntimeStore({
      client,
      auth: () => owner.accessToken,
      headers: team(),
      body: authority,
    });
    expect(contended.response?.status).toBe(409);

    const renewed = await renewRuntimeStore({
      client,
      auth: () => owner.accessToken,
      headers: team(),
      path: { storeId: handle.storeId },
      body: writer,
    });
    expect(renewed.error).toBeUndefined();
    expect(renewed.data!.writerToken).toBe(handle.writerToken);
    expect(Date.parse(renewed.data!.writerExpiresAt)).toBeGreaterThanOrEqual(
      Date.parse(handle.writerExpiresAt),
    );

    const released = await releaseRuntimeStore({
      client,
      auth: () => owner.accessToken,
      headers: team(),
      path: { storeId: handle.storeId },
      body: writer,
    });
    expect(released.response?.status).toBe(204);

    const staleWriter = await append(handle.storeId, writer, emptyCommit(0));
    expect(staleWriter.response?.status).toBe(409);

    // Reopening the same attempt reattaches its store under a new token.
    const reopened = await open(authority);
    expect(reopened.storeId).toBe(handle.storeId);
    expect(reopened.writerToken).not.toBe(handle.writerToken);
  });

  it('rejects writers without the attempt lease and executor', async () => {
    const authority = await claim();
    for (const forged of [
      { ...authority, leaseId: randomUUID() },
      { ...authority, executorFingerprint: 'bafyreiforged-executor' },
    ]) {
      const opened = await openRuntimeStore({
        client,
        auth: () => owner.accessToken,
        headers: team(),
        body: forged,
      });
      expect(opened.response?.status).toBe(409);
    }
  });

  it('rejects forged authority on an open store', async () => {
    const authority = await claim();
    const handle = await open(authority);
    const writer = { ...authority, writerToken: handle.writerToken };

    // Lease and executor fail the attempt authority check; a token that is
    // not the store's fails the writer check. Both report a conflict.
    for (const forged of [
      { ...writer, leaseId: randomUUID() },
      { ...writer, executorFingerprint: 'bafyreiforged-executor' },
      { ...writer, writerToken: randomUUID() },
    ]) {
      const appended = await append(handle.storeId, forged, emptyCommit(0));
      expect(appended.response?.status).toBe(409);
      const minted = await mint(handle.storeId, forged);
      expect(minted.response?.status).toBe(409);
    }

    const owned = await append(handle.storeId, writer, emptyCommit(0));
    expect(owned.data).toEqual({ seq: 1 });
  });

  it('admits exactly one of two appends racing for the same head', async () => {
    const authority = await claim();
    const handle = await open(authority);
    const writer = { ...authority, writerToken: handle.writerToken };

    const raced = await Promise.all([
      append(handle.storeId, writer, emptyCommit(0)),
      append(handle.storeId, writer, emptyCommit(0)),
    ]);

    expect(
      raced.map((result) => result.response?.status).sort((a, b) => a! - b!),
    ).toEqual([200, 409]);
    expect(raced.find((result) => result.data)?.data).toEqual({ seq: 1 });
    const all = await readCommits(handle.storeId, {});
    expect(all.header).toEqual({ headSeq: 1, count: 1 });
  });

  it('lets the attempt take over a store whose writer lease expired', async () => {
    // The writer lease is capped by the claim lease, so a short claim followed
    // by a long heartbeat leaves the attempt live while its writer expires.
    const authority = await claim({ leaseTtlSec: SHORT_CLAIM_TTL_SEC });
    const handle = await open(authority);
    const stale = { ...authority, writerToken: handle.writerToken };
    const heartbeat = await taskHeartbeat({
      client,
      auth: () => owner.accessToken,
      headers: team(),
      path: { id: authority.taskId, n: authority.attemptN },
      body: { leaseTtlSec: DEFAULT_LEASE_TTL_SEC },
    });
    expect(heartbeat.error).toBeUndefined();

    // Reopening is refused while the writer is active and succeeds after.
    let takeover: Awaited<ReturnType<typeof openRuntimeStore>> | undefined;
    await expect
      .poll(
        async () => {
          takeover = await openRuntimeStore({
            client,
            auth: () => owner.accessToken,
            headers: team(),
            body: authority,
          });
          return takeover.response?.status;
        },
        { timeout: (SHORT_CLAIM_TTL_SEC + 10) * 1000, interval: 500 },
      )
      .toBe(200);
    const reopened = takeover!.data!;
    expect(reopened.storeId).toBe(handle.storeId);
    expect(reopened.writerToken).not.toBe(handle.writerToken);

    const staleWrite = await append(handle.storeId, stale, emptyCommit(0));
    expect(staleWrite.response?.status).toBe(409);
    const fresh = { ...authority, writerToken: reopened.writerToken };
    expect((await append(handle.storeId, fresh, emptyCommit(0))).data).toEqual({
      seq: 1,
    });
  });

  it('hides stores from agents outside the team', async () => {
    const authority = await claim();
    const handle = await open(authority);

    // The auth plugin rejects a team header naming a team the caller is not in.
    const read = await readCommits(handle.storeId, {}, outsider.accessToken);
    expect(read.status).toBe(403);

    const lookup = await getRuntimeStoreForAttempt({
      client,
      auth: () => outsider.accessToken,
      headers: team(),
      query: { taskId: authority.taskId, attemptN: authority.attemptN },
    });
    expect(lookup.response?.status).toBe(403);

    const opened = await openRuntimeStore({
      client,
      auth: () => outsider.accessToken,
      headers: team(),
      body: authority,
    });
    expect(opened.response?.status).toBe(403);
  });

  it('rejects outsiders replaying the owner writer credentials', async () => {
    const authority = await claim();
    const handle = await open(authority);
    const writer = { ...authority, writerToken: handle.writerToken };
    const path = { storeId: handle.storeId };

    const attempts = await Promise.all([
      append(handle.storeId, writer, emptyCommit(0), outsider.accessToken),
      mint(handle.storeId, writer, outsider.accessToken),
      renewRuntimeStore({
        client,
        auth: () => outsider.accessToken,
        headers: team(),
        path,
        body: writer,
      }),
      releaseRuntimeStore({
        client,
        auth: () => outsider.accessToken,
        headers: team(),
        path,
        body: writer,
      }),
    ]);
    expect(attempts.map((attempt) => attempt.response?.status)).toEqual([
      403, 403, 403, 403,
    ]);

    // The owner's lease and head are untouched.
    const owned = await append(handle.storeId, writer, emptyCommit(0));
    expect(owned.error).toBeUndefined();
    expect(owned.data).toEqual({ seq: 1 });
  });
});
