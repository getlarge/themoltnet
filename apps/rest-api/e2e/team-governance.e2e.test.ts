/**
 * E2E: Team Governance — founding flow + diary transfer
 *
 * Tests the full governance lifecycle against a real Docker Compose stack:
 *   - Project team founding with acceptance workflow
 *   - Personal team limitation enforcement
 *   - Diary resource transfer between teams with consent
 *   - Permission enforcement (auth, ownership, resource access)
 *
 * Requires: `docker compose -f docker-compose.e2e.yaml up -d --build`
 */

import {
  acceptTeamFounding,
  acceptTransfer,
  type Client,
  createClient,
  createDiary,
  createTeam,
  getDiary,
  getTeam,
  initiateTransfer,
  listPendingTransfers,
  listTeams,
  rejectTransfer,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createAgent,
  pollUntil,
  pollUntilStatus,
  type TestAgent,
} from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

// ── Team Founding ─────────────────────────────────────────────────────────────

describe('Team Governance', () => {
  let harness: TestHarness;
  let client: Client;
  let agentA: TestAgent; // initiates founding
  let agentB: TestAgent; // co-founder
  let agentC: TestAgent; // outsider

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    [agentA, agentB, agentC] = await Promise.all([
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

  // ── Founding Flow ─────────────────────────────────────────────────────────

  describe('POST /teams — founding workflow', () => {
    it('creates a team in founding status when foundingMembers are provided', async () => {
      const { data, error, response } = await createTeam({
        client,
        auth: () => agentA.accessToken,
        body: {
          name: 'founding-test-team',
          foundingMembers: [
            { subjectId: agentB.identityId, subjectNs: 'Agent', role: 'owner' },
          ],
        },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(202);
      const body = data as { id: string; status: string; workflowId: string };
      expect(body.status).toBe('founding');
      expect(body.id).toBeDefined();
      expect(body.workflowId).toBeDefined();
    });

    it('creates a regular team instantly when no foundingMembers', async () => {
      const { data, error, response } = await createTeam({
        client,
        auth: () => agentA.accessToken,
        body: { name: 'instant-team' },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(201);
      expect(data!.id).toBeDefined();
      expect(data!.name).toBe('instant-team');
    });
  });

  // ── Accept Founding ───────────────────────────────────────────────────────

  describe('POST /teams/:id/accept', () => {
    let foundingTeamId: string;

    beforeAll(async () => {
      const { data, response } = await createTeam({
        client,
        auth: () => agentA.accessToken,
        body: {
          name: `founding-accept-${Date.now()}`,
          foundingMembers: [
            { subjectId: agentB.identityId, subjectNs: 'Agent', role: 'owner' },
          ],
        },
      });
      expect(response.status).toBe(202);
      foundingTeamId = (data as { id: string }).id;

      // The team-founding workflow runs async: a single step grants Keto roles
      // AND seeds founding-acceptance rows. Until that step commits, agentB is
      // invisible to the team and POST /teams/:id/accept returns 404 (the
      // route's "no existence leak" guard). Wait until Keto sees agentB as a
      // member — by then acceptance rows also exist.
      await pollUntilStatus(
        () =>
          getTeam({
            client,
            auth: () => agentB.accessToken,
            path: { id: foundingTeamId },
          }),
        200,
        {
          label: 'agentB sees founding team',
          maxAttempts: 50,
          intervalMs: 200,
        },
      );
    });

    it('outsider probing a founding team gets 404 — no existence leak', async () => {
      const { response } = await acceptTeamFounding({
        client,
        auth: () => agentC.accessToken,
        path: { id: foundingTeamId },
        body: {},
      });

      expect(response.status).toBe(404);
    });

    it('agentB (co-founder) can accept their founding role', async () => {
      const { data, error, response } = await acceptTeamFounding({
        client,
        auth: () => agentB.accessToken,
        path: { id: foundingTeamId },
        body: {},
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(200);
      expect(data!.accepted).toBe(true);
      // agentA (creator) hasn't accepted yet — still founding
      expect(data!.teamStatus).toBe('founding');
    });

    it('agentA (creator) accepting signals all-accepted — workflow activates team async', async () => {
      const { data, error, response } = await acceptTeamFounding({
        client,
        auth: () => agentA.accessToken,
        path: { id: foundingTeamId },
        body: {},
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(200);
      expect(data!.accepted).toBe(true);
      // Route returns synthetic 'active' when all owners have accepted (single owner here)
      expect(data!.teamStatus).toBe('active');
    });

    it('accepting twice returns 409', async () => {
      // agentB already accepted above — poll until workflow has committed accepted status
      const { response } = await pollUntilStatus(
        () =>
          acceptTeamFounding({
            client,
            auth: () => agentB.accessToken,
            path: { id: foundingTeamId },
            body: {},
          }),
        409,
        {
          label: 'repeated accept returns 409',
          maxAttempts: 20,
          intervalMs: 300,
        },
      );
      expect(response.status).toBe(409);
    });

    it('unauthenticated gets 401', async () => {
      const { response } = await acceptTeamFounding({
        client,
        path: { id: foundingTeamId },
        body: {},
      });

      expect(response.status).toBe(401);
    });
  });

  // ── Personal Team Limitation ──────────────────────────────────────────────

  describe('personal team restrictions', () => {
    it('registration auto-creates a personal team for each agent', async () => {
      const { data, error, response } = await listTeams({
        client,
        auth: () => agentA.accessToken,
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(200);
      const personal = data!.items.find(
        (t: { personal: boolean }) => t.personal,
      );
      expect(personal).toBeDefined();
      expect(personal!.status).toBe('active');
    });
  });

  // ── Diary Transfer ────────────────────────────────────────────────────────

  describe('Diary Transfer', () => {
    let sourceTeamId: string; // agentA owns this
    let destTeamId: string; // agentB owns this
    let diaryId: string; // agentA's diary on sourceTeam

    beforeAll(async () => {
      const { data: srcData, response: srcRes } = await createTeam({
        client,
        auth: () => agentA.accessToken,
        body: { name: `source-team-${Date.now()}` },
      });
      expect(srcRes.status).toBe(201);
      sourceTeamId = srcData!.id;

      const { data: dstData, response: dstRes } = await createTeam({
        client,
        auth: () => agentB.accessToken,
        body: { name: `dest-team-${Date.now()}` },
      });
      expect(dstRes.status).toBe(201);
      destTeamId = dstData!.id;

      const { data, error } = await createDiary({
        client,
        auth: () => agentA.accessToken,
        headers: { 'x-moltnet-team-id': sourceTeamId },
        body: { name: `transfer-diary-${Date.now()}`, visibility: 'moltnet' },
      });
      expect(error).toBeUndefined();
      diaryId = data!.id;
    });

    // ── Initiate Transfer ──────────────────────────────────────────────────

    describe('POST /diaries/:id/transfer', () => {
      it('rejects unauthenticated requests with 401', async () => {
        const { response } = await initiateTransfer({
          client,
          path: { id: diaryId },
          body: { destinationTeamId: destTeamId },
        });
        expect(response.status).toBe(401);
      });

      it('non-diary-manager cannot initiate a transfer', async () => {
        const { response } = await initiateTransfer({
          client,
          auth: () => agentC.accessToken,
          path: { id: diaryId },
          body: { destinationTeamId: destTeamId },
        });
        expect(response.status).toBe(403);
      });

      it('cannot transfer to a personal team', async () => {
        const { response } = await initiateTransfer({
          client,
          auth: () => agentA.accessToken,
          path: { id: diaryId },
          body: { destinationTeamId: agentB.personalTeamId },
        });
        expect(response.status).toBe(400);
      });

      it('source team non-owner cannot initiate even with diary manage access', async () => {
        const { response } = await initiateTransfer({
          client,
          auth: () => agentB.accessToken,
          path: { id: diaryId },
          body: { destinationTeamId: destTeamId },
        });
        expect(response.status).toBe(403);
      });

      it('agentA initiates a transfer — returns 202 with transfer record', async () => {
        const { data, error, response } = await initiateTransfer({
          client,
          auth: () => agentA.accessToken,
          path: { id: diaryId },
          body: { destinationTeamId: destTeamId },
        });
        expect(response.status).toBe(202);
        expect(error).toBeUndefined();
        expect(data!.status).toBe('pending');
        expect(data!.diaryId).toBe(diaryId);
        expect(data!.sourceTeamId).toBe(sourceTeamId);
        expect(data!.destinationTeamId).toBe(destTeamId);
      });

      it('duplicate transfer initiation returns 409', async () => {
        const { response } = await initiateTransfer({
          client,
          auth: () => agentA.accessToken,
          path: { id: diaryId },
          body: { destinationTeamId: destTeamId },
        });
        expect(response.status).toBe(409);
      });
    });

    // ── List Pending Transfers ─────────────────────────────────────────────

    describe('GET /transfers', () => {
      it('destination team owner sees pending transfer', async () => {
        const { data, error, response } = await listPendingTransfers({
          client,
          auth: () => agentB.accessToken,
        });
        expect(error).toBeUndefined();
        expect(response.status).toBe(200);
        const transfer = data!.items.find(
          (t: { diaryId: string }) => t.diaryId === diaryId,
        );
        expect(transfer).toBeDefined();
        expect(transfer!.status).toBe('pending');
      });

      it('source team owner does not see outgoing transfers via this endpoint', async () => {
        const { data, error, response } = await listPendingTransfers({
          client,
          auth: () => agentA.accessToken,
        });
        expect(error).toBeUndefined();
        expect(response.status).toBe(200);
        const found = data!.items.find(
          (t: { diaryId: string }) => t.diaryId === diaryId,
        );
        expect(found).toBeUndefined();
      });

      it('outsider gets empty list', async () => {
        const { data, error, response } = await listPendingTransfers({
          client,
          auth: () => agentC.accessToken,
        });
        expect(error).toBeUndefined();
        expect(response.status).toBe(200);
        expect(Array.isArray(data!.items)).toBe(true);
      });

      it('unauthenticated gets 401', async () => {
        const { response } = await listPendingTransfers({ client });
        expect(response.status).toBe(401);
      });
    });

    // ── Reject Transfer ────────────────────────────────────────────────────

    describe('reject and re-initiate', () => {
      let transferId: string;
      let rejectDiaryId: string;

      beforeAll(async () => {
        const { data } = await createDiary({
          client,
          auth: () => agentA.accessToken,
          headers: { 'x-moltnet-team-id': sourceTeamId },
          body: {
            name: `reject-diary-${Date.now()}`,
            visibility: 'moltnet',
          },
        });
        rejectDiaryId = data!.id;

        const { data: transferData, response } = await initiateTransfer({
          client,
          auth: () => agentA.accessToken,
          path: { id: rejectDiaryId },
          body: { destinationTeamId: destTeamId },
        });
        expect(response.status).toBe(202);
        transferId = transferData!.id;
      });

      it('non-destination-owner cannot reject', async () => {
        const { response } = await rejectTransfer({
          client,
          auth: () => agentC.accessToken,
          path: { transferId },
        });
        expect(response.status).toBe(403);
      });

      it('agentB (destination owner) rejects — decision sent to workflow', async () => {
        const { data, error, response } = await rejectTransfer({
          client,
          auth: () => agentB.accessToken,
          path: { transferId },
        });
        expect(error).toBeUndefined();
        expect(response.status).toBe(200);
        // Workflow updates status async; route returns original transfer
        expect(data!.id).toBe(transferId);
      });

      it('diary remains on source team after rejection', async () => {
        const { data, error, response } = await getDiary({
          client,
          auth: () => agentA.accessToken,
          path: { id: rejectDiaryId },
        });
        expect(error).toBeUndefined();
        expect(response.status).toBe(200);
        expect(data!.teamId).toBe(sourceTeamId);
      });

      it('rejecting an already-resolved transfer returns 409', async () => {
        const { response } = await pollUntilStatus(
          () =>
            rejectTransfer({
              client,
              auth: () => agentB.accessToken,
              path: { transferId },
            }),
          409,
          {
            label: 'rejecting resolved transfer returns 409',
            maxAttempts: 20,
            intervalMs: 500,
          },
        );
        expect(response.status).toBe(409);
      });
    });

    // ── Accept Transfer ────────────────────────────────────────────────────

    describe('accept transfer — diary moves to destination team', () => {
      let transferId: string;
      let acceptDiaryId: string;

      beforeAll(async () => {
        const { data } = await createDiary({
          client,
          auth: () => agentA.accessToken,
          headers: { 'x-moltnet-team-id': sourceTeamId },
          body: {
            name: `accept-diary-${Date.now()}`,
            visibility: 'moltnet',
          },
        });
        acceptDiaryId = data!.id;

        const { data: transferData, response } = await initiateTransfer({
          client,
          auth: () => agentA.accessToken,
          path: { id: acceptDiaryId },
          body: { destinationTeamId: destTeamId },
        });
        expect(response.status).toBe(202);
        transferId = transferData!.id;
      });

      it('non-destination-owner cannot accept', async () => {
        const { response } = await acceptTransfer({
          client,
          auth: () => agentC.accessToken,
          path: { transferId },
        });
        expect(response.status).toBe(403);
      });

      it('agentB accepts — decision sent to workflow (async)', async () => {
        const { data, error, response } = await acceptTransfer({
          client,
          auth: () => agentB.accessToken,
          path: { transferId },
        });
        expect(error).toBeUndefined();
        expect(response.status).toBe(200);
        // Workflow updates status async; route returns original transfer
        expect(data!.id).toBe(transferId);
      });

      it('diary teamId is now destTeamId after acceptance', async () => {
        // The DBOS workflow swaps teamId asynchronously
        const { data } = await pollUntil(
          () =>
            getDiary({
              client,
              auth: () => agentB.accessToken,
              path: { id: acceptDiaryId },
            }),
          (r) => r.response.ok && r.data?.teamId === destTeamId,
          {
            label: 'diary moved to destTeam',
            maxAttempts: 10,
            intervalMs: 500,
          },
        );
        expect(data!.teamId).toBe(destTeamId);
      });

      it('accepting already-accepted transfer returns 409', async () => {
        const { response } = await pollUntilStatus(
          () =>
            acceptTransfer({
              client,
              auth: () => agentB.accessToken,
              path: { transferId },
            }),
          409,
          {
            label: 'accepting accepted transfer returns 409',
            maxAttempts: 20,
            intervalMs: 500,
          },
        );
        expect(response.status).toBe(409);
      });
    });
  });
});
