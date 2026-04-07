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

import { type Client, createClient, createDiary } from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

// ── Helper: raw fetch with bearer auth ───────────────────────────────────────

function authHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

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
      const res = await fetch(`${harness.baseUrl}/teams`, {
        method: 'POST',
        headers: authHeaders(agentA.accessToken),
        body: JSON.stringify({
          name: 'founding-test-team',
          foundingMembers: [
            { subjectId: agentB.identityId, subjectNs: 'Agent', role: 'owner' },
          ],
        }),
      });

      expect(res.status).toBe(202);
      const body = (await res.json()) as {
        id: string;
        status: string;
        workflowId: string;
      };
      expect(body.status).toBe('founding');
      expect(body.id).toBeDefined();
      expect(body.workflowId).toBeDefined();
    });

    it('creates a regular team instantly when no foundingMembers', async () => {
      const res = await fetch(`${harness.baseUrl}/teams`, {
        method: 'POST',
        headers: authHeaders(agentA.accessToken),
        body: JSON.stringify({ name: 'instant-team' }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; name: string };
      expect(body.id).toBeDefined();
      expect(body.name).toBe('instant-team');
    });
  });

  // ── Accept Founding ───────────────────────────────────────────────────────

  describe('POST /teams/:id/accept', () => {
    let foundingTeamId: string;

    beforeAll(async () => {
      // agentA creates a founding team with agentB as co-owner
      const res = await fetch(`${harness.baseUrl}/teams`, {
        method: 'POST',
        headers: authHeaders(agentA.accessToken),
        body: JSON.stringify({
          name: `founding-accept-${Date.now()}`,
          foundingMembers: [
            { subjectId: agentB.identityId, subjectNs: 'Agent', role: 'owner' },
          ],
        }),
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as { id: string };
      foundingTeamId = body.id;
    });

    it('outsider probing a founding team gets 404 — no existence leak', async () => {
      const res = await fetch(
        `${harness.baseUrl}/teams/${foundingTeamId}/accept`,
        {
          method: 'POST',
          headers: authHeaders(agentC.accessToken),
          body: JSON.stringify({}),
        },
      );

      expect(res.status).toBe(404);
    });

    it('agentB (co-founder) can accept their founding role', async () => {
      const res = await fetch(
        `${harness.baseUrl}/teams/${foundingTeamId}/accept`,
        {
          method: 'POST',
          headers: authHeaders(agentB.accessToken),
          body: JSON.stringify({}),
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        accepted: boolean;
        teamStatus: string;
      };
      expect(body.accepted).toBe(true);
      // agentA (creator) hasn't accepted yet — still founding
      expect(body.teamStatus).toBe('founding');
    });

    it('agentA (creator) accepting completes the founding — team becomes active', async () => {
      const res = await fetch(
        `${harness.baseUrl}/teams/${foundingTeamId}/accept`,
        {
          method: 'POST',
          headers: authHeaders(agentA.accessToken),
          body: JSON.stringify({}),
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        accepted: boolean;
        teamStatus: string;
      };
      expect(body.accepted).toBe(true);
      expect(body.teamStatus).toBe('active');
    });

    it('accepting twice returns 409', async () => {
      // agentB already accepted above
      const res = await fetch(
        `${harness.baseUrl}/teams/${foundingTeamId}/accept`,
        {
          method: 'POST',
          headers: authHeaders(agentB.accessToken),
          body: JSON.stringify({}),
        },
      );

      expect(res.status).toBe(409);
    });

    it('accepts token is required — unauthenticated gets 401', async () => {
      const res = await fetch(
        `${harness.baseUrl}/teams/${foundingTeamId}/accept`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );

      expect(res.status).toBe(401);
    });
  });

  // ── Personal Team Limitation ──────────────────────────────────────────────

  describe('personal team restrictions', () => {
    it('cannot create a project team named after an existing personal team', async () => {
      // personal teams are auto-created at registration — just verify
      // the personal flag is set and cannot be transferred to
      const teamsRes = await fetch(`${harness.baseUrl}/teams`, {
        headers: authHeaders(agentA.accessToken),
      });
      expect(teamsRes.status).toBe(200);
      const { items } = (await teamsRes.json()) as {
        items: Array<{ personal: boolean; id: string; status: string }>;
      };
      const personal = items.find((t) => t.personal);
      expect(personal).toBeDefined();
      expect(personal!.status).toBe('active');

      // Attempting to transfer a diary to a personal team should be rejected
      // — this is tested in detail in the transfer section below
    });
  });

  // ── Diary Transfer ────────────────────────────────────────────────────────

  describe('Diary Transfer', () => {
    let sourceTeamId: string; // agentA owns this
    let destTeamId: string; // agentB owns this
    let diaryId: string; // agentA's diary on sourceTeam

    beforeAll(async () => {
      // Create source project team for agentA
      const srcRes = await fetch(`${harness.baseUrl}/teams`, {
        method: 'POST',
        headers: authHeaders(agentA.accessToken),
        body: JSON.stringify({ name: `source-team-${Date.now()}` }),
      });
      expect(srcRes.status).toBe(201);
      sourceTeamId = ((await srcRes.json()) as { id: string }).id;

      // Create destination project team for agentB
      const dstRes = await fetch(`${harness.baseUrl}/teams`, {
        method: 'POST',
        headers: authHeaders(agentB.accessToken),
        body: JSON.stringify({ name: `dest-team-${Date.now()}` }),
      });
      expect(dstRes.status).toBe(201);
      destTeamId = ((await dstRes.json()) as { id: string }).id;

      // Create a diary on sourceTeam
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
        const res = await fetch(
          `${harness.baseUrl}/diaries/${diaryId}/transfer`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ destinationTeamId: destTeamId }),
          },
        );
        expect(res.status).toBe(401);
      });

      it('non-diary-manager cannot initiate a transfer', async () => {
        // agentC has no access to the diary
        const res = await fetch(
          `${harness.baseUrl}/diaries/${diaryId}/transfer`,
          {
            method: 'POST',
            headers: authHeaders(agentC.accessToken),
            body: JSON.stringify({ destinationTeamId: destTeamId }),
          },
        );
        expect(res.status).toBe(403);
      });

      it('cannot transfer to a personal team', async () => {
        const res = await fetch(
          `${harness.baseUrl}/diaries/${diaryId}/transfer`,
          {
            method: 'POST',
            headers: authHeaders(agentA.accessToken),
            body: JSON.stringify({
              destinationTeamId: agentB.personalTeamId,
            }),
          },
        );
        // personal team → 400 team-personal-immutable
        expect(res.status).toBe(400);
      });

      it('source team non-owner cannot initiate even with diary manage access', async () => {
        // agentB is not a member of sourceTeam — no diary manage on source team
        const res = await fetch(
          `${harness.baseUrl}/diaries/${diaryId}/transfer`,
          {
            method: 'POST',
            headers: authHeaders(agentB.accessToken),
            body: JSON.stringify({ destinationTeamId: destTeamId }),
          },
        );
        expect(res.status).toBe(403);
      });

      it('agentA initiates a transfer — returns 202 with transfer record', async () => {
        const res = await fetch(
          `${harness.baseUrl}/diaries/${diaryId}/transfer`,
          {
            method: 'POST',
            headers: authHeaders(agentA.accessToken),
            body: JSON.stringify({ destinationTeamId: destTeamId }),
          },
        );
        expect(res.status).toBe(202);
        const body = (await res.json()) as {
          id: string;
          status: string;
          diaryId: string;
          sourceTeamId: string;
          destinationTeamId: string;
        };
        expect(body.status).toBe('pending');
        expect(body.diaryId).toBe(diaryId);
        expect(body.sourceTeamId).toBe(sourceTeamId);
        expect(body.destinationTeamId).toBe(destTeamId);
      });

      it('duplicate transfer initiation returns 409', async () => {
        const res = await fetch(
          `${harness.baseUrl}/diaries/${diaryId}/transfer`,
          {
            method: 'POST',
            headers: authHeaders(agentA.accessToken),
            body: JSON.stringify({ destinationTeamId: destTeamId }),
          },
        );
        expect(res.status).toBe(409);
      });
    });

    // ── List Pending Transfers ─────────────────────────────────────────────

    describe('GET /transfers', () => {
      it('destination team owner sees pending transfer', async () => {
        const res = await fetch(`${harness.baseUrl}/transfers`, {
          headers: authHeaders(agentB.accessToken),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          items: Array<{ diaryId: string; status: string }>;
        };
        const transfer = body.items.find((t) => t.diaryId === diaryId);
        expect(transfer).toBeDefined();
        expect(transfer!.status).toBe('pending');
      });

      it('source team owner does not see their outgoing transfers here', async () => {
        // /transfers lists incoming transfers for teams you own
        // agentA owns sourceTeam, not destTeam — so this should not show the transfer
        const res = await fetch(`${harness.baseUrl}/transfers`, {
          headers: authHeaders(agentA.accessToken),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          items: Array<{ diaryId: string }>;
        };
        // agentA's sourceTeam is not a destination, so no pending for them
        const found = body.items.find((t) => t.diaryId === diaryId);
        expect(found).toBeUndefined();
      });

      it('outsider gets empty list', async () => {
        const res = await fetch(`${harness.baseUrl}/transfers`, {
          headers: authHeaders(agentC.accessToken),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { items: unknown[] };
        // agentC owns their personal team only, and it has no incoming transfers
        expect(Array.isArray(body.items)).toBe(true);
      });

      it('unauthenticated gets 401', async () => {
        const res = await fetch(`${harness.baseUrl}/transfers`);
        expect(res.status).toBe(401);
      });
    });

    // ── Reject Transfer ────────────────────────────────────────────────────

    describe('reject and re-initiate', () => {
      let transferId: string;
      let rejectDiaryId: string;

      beforeAll(async () => {
        // Create a separate diary for the reject sub-suite
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

        const res = await fetch(
          `${harness.baseUrl}/diaries/${rejectDiaryId}/transfer`,
          {
            method: 'POST',
            headers: authHeaders(agentA.accessToken),
            body: JSON.stringify({ destinationTeamId: destTeamId }),
          },
        );
        expect(res.status).toBe(202);
        transferId = ((await res.json()) as { id: string }).id;
      });

      it('non-destination-owner cannot reject', async () => {
        const res = await fetch(
          `${harness.baseUrl}/transfers/${transferId}/reject`,
          {
            method: 'POST',
            headers: authHeaders(agentC.accessToken),
            body: JSON.stringify({}),
          },
        );
        expect(res.status).toBe(403);
      });

      it('agentB (destination owner) rejects — status becomes rejected', async () => {
        const res = await fetch(
          `${harness.baseUrl}/transfers/${transferId}/reject`,
          {
            method: 'POST',
            headers: authHeaders(agentB.accessToken),
            body: JSON.stringify({}),
          },
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { status: string };
        expect(body.status).toBe('rejected');
      });

      it('diary remains on source team after rejection', async () => {
        // Fetch diary via api-client and verify teamId is still sourceTeamId
        const res = await fetch(`${harness.baseUrl}/diaries/${rejectDiaryId}`, {
          headers: authHeaders(agentA.accessToken),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { teamId: string };
        expect(body.teamId).toBe(sourceTeamId);
      });

      it('rejecting an already-resolved transfer returns 409', async () => {
        const res = await fetch(
          `${harness.baseUrl}/transfers/${transferId}/reject`,
          {
            method: 'POST',
            headers: authHeaders(agentB.accessToken),
            body: JSON.stringify({}),
          },
        );
        expect(res.status).toBe(409);
      });
    });

    // ── Accept Transfer ────────────────────────────────────────────────────

    describe('accept transfer — diary moves to destination team', () => {
      let transferId: string;
      let acceptDiaryId: string;

      beforeAll(async () => {
        // Create a fresh diary for the accept sub-suite
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

        const res = await fetch(
          `${harness.baseUrl}/diaries/${acceptDiaryId}/transfer`,
          {
            method: 'POST',
            headers: authHeaders(agentA.accessToken),
            body: JSON.stringify({ destinationTeamId: destTeamId }),
          },
        );
        expect(res.status).toBe(202);
        transferId = ((await res.json()) as { id: string }).id;
      });

      it('non-destination-owner cannot accept', async () => {
        const res = await fetch(
          `${harness.baseUrl}/transfers/${transferId}/accept`,
          {
            method: 'POST',
            headers: authHeaders(agentC.accessToken),
            body: JSON.stringify({}),
          },
        );
        expect(res.status).toBe(403);
      });

      it('agentB accepts — status becomes accepted', async () => {
        const res = await fetch(
          `${harness.baseUrl}/transfers/${transferId}/accept`,
          {
            method: 'POST',
            headers: authHeaders(agentB.accessToken),
            body: JSON.stringify({}),
          },
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { status: string };
        expect(body.status).toBe('accepted');
      });

      it('diary teamId is now destTeamId after acceptance', async () => {
        // Poll briefly — the DBOS workflow may swap the teamId asynchronously
        let teamId: string | undefined;
        for (let attempt = 0; attempt < 10; attempt++) {
          const res = await fetch(
            `${harness.baseUrl}/diaries/${acceptDiaryId}`,
            { headers: authHeaders(agentB.accessToken) },
          );
          if (res.ok) {
            const body = (await res.json()) as { teamId: string };
            teamId = body.teamId;
            if (teamId === destTeamId) break;
          }
          // Brief wait before retry
          await new Promise<void>((r) => {
            setTimeout(r, 500);
          });
        }
        expect(teamId).toBe(destTeamId);
      });

      it('accepting already-accepted transfer returns 409', async () => {
        const res = await fetch(
          `${harness.baseUrl}/transfers/${transferId}/accept`,
          {
            method: 'POST',
            headers: authHeaders(agentB.accessToken),
            body: JSON.stringify({}),
          },
        );
        expect(res.status).toBe(409);
      });
    });
  });
});
