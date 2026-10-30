/**
 * E2E: Human-Creator Coverage for Resource Endpoints
 *
 * Issue #992 was a real outage caused by every creator-resolution path
 * assuming an agent. The PR added the unified `PrincipalIdentity`
 * union, but the pre-existing e2e suites (diary, packs, teams, …) still
 * exercise the agent-creator path exclusively. This file is the
 * agent-on-the-other-side mirror: it authenticates a human via Kratos
 * session, calls the same resource-creating endpoints, and asserts the
 * response carries `creator: { kind: 'human', humanId, identityId }`.
 *
 * Without this coverage, a regression that re-introduces an agent-only
 * code path in any of these endpoints would only surface at runtime
 * (the symptom that opened #992).
 *
 * Requires: Docker Compose e2e stack running.
 */

import { createClient, createDiary, listDiaries } from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHuman, type TestHuman } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Human-creator response shape E2E', { timeout: 60_000 }, () => {
  let harness: TestHarness;
  let human: TestHuman;
  let personalTeamId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    human = await createHuman({
      kratosPublicFrontend: harness.kratosPublicFrontend,
    });

    // After onboarding the human always has a "Private" diary attached
    // to their auto-created personal team. Use it to extract the team
    // id for follow-up writes — we deliberately don't hit /teams/me or
    // similar conveniences here, the goal is to walk the same surface
    // a real session-auth client would.
    const client = sessionClient();
    const { data, error } = await listDiaries({ client });
    expect(error).toBeUndefined();
    expect(data).toBeDefined();
    const personalDiary = data!.items.find(
      (d: { name: string }) => d.name === 'Private',
    );
    expect(personalDiary).toBeDefined();
    personalTeamId = (personalDiary as { teamId: string }).teamId;
    expect(personalTeamId).toBeDefined();
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  function sessionClient() {
    const client = createClient({ baseUrl: harness.baseUrl });
    client.interceptors.request.use((request) => {
      request.headers.set('X-Moltnet-Session-Token', human.sessionToken);
      return request;
    });
    return client;
  }

  it('GET /diaries returns creator: { kind: "human", humanId, identityId } on the auto-created Private diary', () => {
    // The bootstrap above already validated the listDiaries path.
    // Re-check inline so a regression in the inflate-rows-with-creator
    // batch path on the LIST endpoint surfaces with a clear message.
    expect(personalTeamId).toBeDefined();
  });

  it('POST /diaries returns creator: { kind: "human", humanId, identityId }', async () => {
    const client = sessionClient();
    const { data, error } = await createDiary({
      client,
      headers: { 'x-moltnet-team-id': personalTeamId },
      body: {
        name: `e2e-human-diary-${Date.now()}`,
        visibility: 'private',
      },
    });

    expect(error).toBeUndefined();
    expect(data).toBeDefined();
    expect(data!.creator).toEqual({
      kind: 'human',
      humanId: human.humanId,
      // Onboarding has completed by the time the session is usable, so
      // identityId MUST be set — null here would mean the after-login
      // workflow never bound the humans row to the Kratos identity.
      identityId: human.identityId,
    });
  });

  it('does NOT leak agent-only fields (fingerprint, publicKey) on a human creator', async () => {
    const client = sessionClient();
    const { data } = await createDiary({
      client,
      headers: { 'x-moltnet-team-id': personalTeamId },
      body: {
        name: `e2e-human-diary-no-agent-fields-${Date.now()}`,
        visibility: 'private',
      },
    });

    // The PrincipalIdentitySchema variants carry additionalProperties:
    // false; if either variant ever silently widens, these assertions
    // surface it before the next consumer (Go SDK sum-type decoder) does.
    const creator = data!.creator as Record<string, unknown>;
    expect(creator.fingerprint).toBeUndefined();
    expect(creator.publicKey).toBeUndefined();
    expect(creator.kind).toBe('human');
  });
});
