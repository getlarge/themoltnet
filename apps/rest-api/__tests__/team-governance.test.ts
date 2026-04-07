/**
 * Team governance and diary transfer routes unit tests
 */

import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMockServices,
  createTestApp,
  type MockServices,
  OWNER_ID,
  TEST_BEARER_TOKEN,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

// Mock DBOS so workflows don't try to connect to a database
vi.mock('@moltnet/database', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    DBOS: {
      ...actual.DBOS,
      startWorkflow: vi
        .fn()
        .mockReturnValue(
          vi.fn().mockResolvedValue({ workflowID: 'mock-workflow-id' }),
        ),
      send: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// Mock workflow modules so they don't register with DBOS on import
vi.mock('../src/workflows/team-founding-workflow.js', () => ({
  teamFoundingWorkflow: { foundTeam: vi.fn() },
  FOUNDING_ACCEPT_EVENT: 'team.founding.accepted',
}));

vi.mock('../src/workflows/diary-transfer-workflow.js', () => ({
  diaryTransferWorkflow: { transferDiary: vi.fn() },
  TRANSFER_DECISION_EVENT: 'diary.transfer.decision',
}));

// Need to import DBOS after mock to get the mocked version
import { DBOS } from '@moltnet/database';

const authHeaders = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };

const TEAM_ID = 'aa0e8400-e29b-41d4-a716-446655440011';
const OTHER_TEAM_ID = 'bb0e8400-e29b-41d4-a716-446655440012';
const DIARY_ID = '880e8400-e29b-41d4-a716-446655440004';
const TRANSFER_ID = 'cc0e8400-e29b-41d4-a716-446655440013';

const MOCK_ACTIVE_TEAM = {
  id: TEAM_ID,
  name: 'Alpha',
  personal: false,
  status: 'active' as const,
  createdBy: OWNER_ID,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const MOCK_FOUNDING_TEAM = { ...MOCK_ACTIVE_TEAM, status: 'founding' as const };
const _MOCK_PERSONAL_TEAM = { ...MOCK_ACTIVE_TEAM, personal: true } as const;
const MOCK_DEST_TEAM = {
  ...MOCK_ACTIVE_TEAM,
  id: OTHER_TEAM_ID,
  name: 'Beta',
};

const MOCK_DIARY = {
  id: DIARY_ID,
  name: 'My Diary',
  teamId: TEAM_ID,
  createdBy: OWNER_ID,
  visibility: 'private' as const,
  signed: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MOCK_TRANSFER = {
  id: TRANSFER_ID,
  diaryId: DIARY_ID,
  sourceTeamId: TEAM_ID,
  destinationTeamId: OTHER_TEAM_ID,
  workflowId: 'transfer-wf-1',
  status: 'pending' as const,
  initiatedBy: OWNER_ID,
  expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  resolvedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── Suite 1: POST /teams — founding flow ─────────────────────────

describe('POST /teams — founding flow', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);

    mocks.transactionRunner.runInTransaction.mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    );
    mocks.relationshipWriter.grantTeamOwners.mockResolvedValue(undefined);
  });

  it('creates team instantly active when no foundingMembers', async () => {
    mocks.teamRepository.create.mockResolvedValue(MOCK_ACTIVE_TEAM);

    const res = await app.inject({
      method: 'POST',
      url: '/teams',
      headers: authHeaders,
      payload: { name: 'Alpha' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ id: TEAM_ID, name: 'Alpha' });
    expect(DBOS.startWorkflow).not.toHaveBeenCalled();
  });

  it('creates team in founding status and starts workflow when foundingMembers provided', async () => {
    mocks.teamRepository.create.mockResolvedValue(MOCK_FOUNDING_TEAM);

    const res = await app.inject({
      method: 'POST',
      url: '/teams',
      headers: authHeaders,
      payload: {
        name: 'Alpha',
        foundingMembers: [
          { subjectId: OWNER_ID, subjectNs: 'Agent', role: 'owner' },
        ],
      },
    });

    expect(res.statusCode).toBe(202);
    expect(DBOS.startWorkflow).toHaveBeenCalled();
  });

  it('returns 202 with workflowId for founding', async () => {
    mocks.teamRepository.create.mockResolvedValue(MOCK_FOUNDING_TEAM);

    const res = await app.inject({
      method: 'POST',
      url: '/teams',
      headers: authHeaders,
      payload: {
        name: 'Alpha',
        foundingMembers: [
          { subjectId: OWNER_ID, subjectNs: 'Agent', role: 'owner' },
        ],
      },
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({
      id: TEAM_ID,
      name: 'Alpha',
      status: 'founding',
      workflowId: 'mock-workflow-id',
    });
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/teams',
      payload: { name: 'Alpha' },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ── Suite 2: POST /teams/:id/accept ──────────────────────────────

describe('POST /teams/:id/accept', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  it('returns 404 when team does not exist', async () => {
    mocks.teamRepository.findById.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/teams/${TEAM_ID}/accept`,
      headers: authHeaders,
      payload: {},
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when team exists but caller is not a founding member (privacy guard)', async () => {
    mocks.teamRepository.findById.mockResolvedValue(MOCK_FOUNDING_TEAM);
    // Caller not in founding acceptances list
    mocks.teamRepository.listFoundingAcceptances.mockResolvedValue([]);

    const res = await app.inject({
      method: 'POST',
      url: `/teams/${TEAM_ID}/accept`,
      headers: authHeaders,
      payload: {},
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 409 founding-already-accepted when caller already accepted', async () => {
    mocks.teamRepository.findById.mockResolvedValue(MOCK_FOUNDING_TEAM);
    mocks.teamRepository.listFoundingAcceptances.mockResolvedValue([
      {
        teamId: TEAM_ID,
        subjectId: OWNER_ID,
        role: 'owner',
        status: 'accepted',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: `/teams/${TEAM_ID}/accept`,
      headers: authHeaders,
      payload: {},
    });

    expect(res.statusCode).toBe(409);
  });

  it('accepts successfully, returns teamStatus founding when not all owners accepted', async () => {
    const pendingAcceptance = {
      teamId: TEAM_ID,
      subjectId: OWNER_ID,
      role: 'owner',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mocks.teamRepository.findById.mockResolvedValue(MOCK_FOUNDING_TEAM);
    // First call (membership check) returns pending
    // Second call (after acceptFoundingMember) returns one still pending owner
    mocks.teamRepository.listFoundingAcceptances
      .mockResolvedValueOnce([pendingAcceptance])
      .mockResolvedValueOnce([{ ...pendingAcceptance, status: 'accepted' }]);
    mocks.teamRepository.acceptFoundingMember.mockResolvedValue({
      ...pendingAcceptance,
      status: 'accepted',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/teams/${TEAM_ID}/accept`,
      headers: authHeaders,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ accepted: true });
    expect(mocks.teamRepository.acceptFoundingMember).toHaveBeenCalledWith(
      TEAM_ID,
      OWNER_ID,
    );
  });

  it('accepts and sends DBOS event when all owners have accepted', async () => {
    const pendingAcceptance = {
      teamId: TEAM_ID,
      subjectId: OWNER_ID,
      role: 'owner',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mocks.teamRepository.findById.mockResolvedValue(MOCK_FOUNDING_TEAM);
    mocks.teamRepository.listFoundingAcceptances
      .mockResolvedValueOnce([pendingAcceptance])
      .mockResolvedValueOnce([{ ...pendingAcceptance, status: 'accepted' }]);
    mocks.teamRepository.acceptFoundingMember.mockResolvedValue({
      ...pendingAcceptance,
      status: 'accepted',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/teams/${TEAM_ID}/accept`,
      headers: authHeaders,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ accepted: true, teamStatus: 'active' });
    expect(DBOS.send).toHaveBeenCalledWith(
      `founding-${TEAM_ID}`,
      true,
      'team.founding.accepted',
    );
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/teams/${TEAM_ID}/accept`,
      payload: {},
    });

    expect(res.statusCode).toBe(401);
  });
});

// ── Suite 3: POST /diaries/:id/transfer ──────────────────────────

describe('POST /diaries/:id/transfer', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);

    mocks.permissionChecker.canManageDiary.mockResolvedValue(true);
    mocks.permissionChecker.canManageTeam.mockResolvedValue(true);
    mocks.diaryService.findDiary.mockResolvedValue(MOCK_DIARY);
    mocks.diaryTransferRepository.findPendingByDiary.mockResolvedValue(null);
    mocks.teamRepository.findById.mockResolvedValue(MOCK_DEST_TEAM);
    mocks.diaryTransferRepository.create.mockResolvedValue(MOCK_TRANSFER);
  });

  it('returns 403 when caller lacks diary manage permission', async () => {
    mocks.permissionChecker.canManageDiary.mockResolvedValue(false);

    const res = await app.inject({
      method: 'POST',
      url: `/diaries/${DIARY_ID}/transfer`,
      headers: authHeaders,
      payload: { destinationTeamId: OTHER_TEAM_ID },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 409 when a pending transfer already exists', async () => {
    mocks.diaryTransferRepository.findPendingByDiary.mockResolvedValue(
      MOCK_TRANSFER,
    );

    const res = await app.inject({
      method: 'POST',
      url: `/diaries/${DIARY_ID}/transfer`,
      headers: authHeaders,
      payload: { destinationTeamId: OTHER_TEAM_ID },
    });

    expect(res.statusCode).toBe(409);
  });

  it('returns 404 when destination team does not exist or is not active', async () => {
    mocks.teamRepository.findById.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/diaries/${DIARY_ID}/transfer`,
      headers: authHeaders,
      payload: { destinationTeamId: OTHER_TEAM_ID },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when destination team is personal', async () => {
    mocks.teamRepository.findById.mockResolvedValue({
      ...MOCK_DEST_TEAM,
      personal: true,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/diaries/${DIARY_ID}/transfer`,
      headers: authHeaders,
      payload: { destinationTeamId: OTHER_TEAM_ID },
    });

    expect(res.statusCode).toBe(400);
  });

  it('initiates transfer successfully, starts workflow, returns 202', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/diaries/${DIARY_ID}/transfer`,
      headers: authHeaders,
      payload: { destinationTeamId: OTHER_TEAM_ID },
    });

    expect(res.statusCode).toBe(202);
    expect(mocks.diaryTransferRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        diaryId: DIARY_ID,
        sourceTeamId: TEAM_ID,
        destinationTeamId: OTHER_TEAM_ID,
        initiatedBy: OWNER_ID,
      }),
    );
    expect(DBOS.startWorkflow).toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/diaries/${DIARY_ID}/transfer`,
      payload: { destinationTeamId: OTHER_TEAM_ID },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ── Suite 4: GET /transfers ───────────────────────────────────────

describe('GET /transfers', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  it('returns empty list when caller owns no teams', async () => {
    mocks.relationshipReader.listTeamIdsAndRolesBySubject.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/transfers',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ items: [] });
  });

  it('returns pending transfers for owned destination teams', async () => {
    mocks.relationshipReader.listTeamIdsAndRolesBySubject.mockResolvedValue([
      { teamId: OTHER_TEAM_ID, relation: 'owners' },
    ]);
    mocks.diaryTransferRepository.listPendingByDestinationTeam.mockResolvedValue(
      [MOCK_TRANSFER],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/transfers',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(1);
    expect(
      mocks.diaryTransferRepository.listPendingByDestinationTeam,
    ).toHaveBeenCalledWith(OTHER_TEAM_ID);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/transfers',
    });

    expect(res.statusCode).toBe(401);
  });
});

// ── Suite 5: POST /transfers/:transferId/accept ───────────────────

describe('POST /transfers/:transferId/accept', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);

    mocks.diaryTransferRepository.findById.mockResolvedValue(MOCK_TRANSFER);
    mocks.permissionChecker.canManageTeam.mockResolvedValue(true);
    mocks.diaryTransferRepository.updateStatus.mockResolvedValue({
      ...MOCK_TRANSFER,
      status: 'accepted' as const,
    });
  });

  it('returns 404 when transfer not found', async () => {
    mocks.diaryTransferRepository.findById.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/transfers/${TRANSFER_ID}/accept`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when transfer already resolved', async () => {
    mocks.diaryTransferRepository.findById.mockResolvedValue({
      ...MOCK_TRANSFER,
      status: 'accepted' as const,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/transfers/${TRANSFER_ID}/accept`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(409);
  });

  it('returns 403 when caller is not destination team owner', async () => {
    mocks.permissionChecker.canManageTeam.mockResolvedValue(false);

    const res = await app.inject({
      method: 'POST',
      url: `/transfers/${TRANSFER_ID}/accept`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(403);
  });

  it('accepts transfer: sends DBOS event and updates status', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/transfers/${TRANSFER_ID}/accept`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    expect(DBOS.send).toHaveBeenCalledWith(
      MOCK_TRANSFER.workflowId,
      'accepted',
      'diary.transfer.decision',
    );
    expect(mocks.diaryTransferRepository.updateStatus).toHaveBeenCalledWith(
      TRANSFER_ID,
      'accepted',
    );
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/transfers/${TRANSFER_ID}/accept`,
    });

    expect(res.statusCode).toBe(401);
  });
});

// ── Suite 6: POST /transfers/:transferId/reject ───────────────────

describe('POST /transfers/:transferId/reject', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);

    mocks.diaryTransferRepository.findById.mockResolvedValue(MOCK_TRANSFER);
    mocks.permissionChecker.canManageTeam.mockResolvedValue(true);
    mocks.diaryTransferRepository.updateStatus.mockResolvedValue({
      ...MOCK_TRANSFER,
      status: 'rejected' as const,
    });
  });

  it('returns 404 when transfer not found', async () => {
    mocks.diaryTransferRepository.findById.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/transfers/${TRANSFER_ID}/reject`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when transfer already resolved', async () => {
    mocks.diaryTransferRepository.findById.mockResolvedValue({
      ...MOCK_TRANSFER,
      status: 'rejected' as const,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/transfers/${TRANSFER_ID}/reject`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(409);
  });

  it('returns 403 when caller is not destination team owner', async () => {
    mocks.permissionChecker.canManageTeam.mockResolvedValue(false);

    const res = await app.inject({
      method: 'POST',
      url: `/transfers/${TRANSFER_ID}/reject`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects transfer: sends DBOS event and updates status', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/transfers/${TRANSFER_ID}/reject`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    expect(DBOS.send).toHaveBeenCalledWith(
      MOCK_TRANSFER.workflowId,
      'rejected',
      'diary.transfer.decision',
    );
    expect(mocks.diaryTransferRepository.updateStatus).toHaveBeenCalledWith(
      TRANSFER_ID,
      'rejected',
    );
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/transfers/${TRANSFER_ID}/reject`,
    });

    expect(res.statusCode).toBe(401);
  });
});
