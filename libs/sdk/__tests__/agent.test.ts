import type { Client } from '@moltnet/api-client';
import {
  compileDiary,
  consolidateDiary,
  createDiary,
  createDiaryEntry,
  createDiaryGrant,
  createSigningRequest,
  createTask,
  createTeam,
  createTeamInvite,
  deleteDiary,
  deleteDiaryEntryById,
  deleteTeam,
  deleteTeamInvite,
  getAgentProfile,
  getCryptoIdentity,
  getDiary,
  getDiaryEntryById,
  getHealth,
  getLegreffierOnboardingStatus,
  getLlmsTxt,
  getNetworkInfo,
  getProblemType,
  getPublicEntry,
  getPublicFeed,
  getSigningRequest,
  getTeam,
  getTrustGraph,
  getWhoami,
  issueVoucher,
  joinTeam,
  listActiveVouchers,
  listDiaries,
  listDiaryEntries,
  listDiaryGrants,
  listProblemTypes,
  listSigningRequests,
  listTasks,
  listTeamInvites,
  listTeamMembers,
  listTeams,
  reflectDiary,
  removeTeamMember,
  requestRecoveryChallenge,
  revokeDiaryGrant,
  rotateClientSecret,
  searchDiary,
  searchPublicFeed,
  startLegreffierOnboarding,
  submitSignature,
  updateContextPack,
  updateDiary,
  updateDiaryEntryById,
  verifyAgentSignature,
  verifyCryptoSignature,
  verifyDiaryEntryById,
  verifyRecoveryChallenge,
} from '@moltnet/api-client';
import { describe, expect, it, vi } from 'vitest';

import { createAgent } from '../src/agent.js';
import { MoltNetError } from '../src/errors.js';
import type { TokenManager } from '../src/token.js';

vi.mock('@moltnet/api-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    listDiaries: vi.fn(),
    createDiary: vi.fn(),
    getDiary: vi.fn(),
    updateDiary: vi.fn(),
    deleteDiary: vi.fn(),
    createDiaryEntry: vi.fn(),
    listDiaryEntries: vi.fn(),
    getDiaryEntryById: vi.fn(),
    updateDiaryEntryById: vi.fn(),
    deleteDiaryEntryById: vi.fn(),
    consolidateDiary: vi.fn(),
    compileDiary: vi.fn(),
    searchDiary: vi.fn(),
    reflectDiary: vi.fn(),
    getWhoami: vi.fn(),
    getAgentProfile: vi.fn(),
    verifyAgentSignature: vi.fn(),
    getCryptoIdentity: vi.fn(),
    verifyCryptoSignature: vi.fn(),
    verifyDiaryEntryById: vi.fn(),
    listSigningRequests: vi.fn(),
    createSigningRequest: vi.fn(),
    getSigningRequest: vi.fn(),
    submitSignature: vi.fn(),
    issueVoucher: vi.fn(),
    listActiveVouchers: vi.fn(),
    getTrustGraph: vi.fn(),
    rotateClientSecret: vi.fn(),
    requestRecoveryChallenge: vi.fn(),
    verifyRecoveryChallenge: vi.fn(),
    getPublicFeed: vi.fn(),
    searchPublicFeed: vi.fn(),
    getPublicEntry: vi.fn(),
    getNetworkInfo: vi.fn(),
    getLlmsTxt: vi.fn(),
    getHealth: vi.fn(),
    startLegreffierOnboarding: vi.fn(),
    getLegreffierOnboardingStatus: vi.fn(),
    listProblemTypes: vi.fn(),
    getProblemType: vi.fn(),
    listTeams: vi.fn(),
    getTeam: vi.fn(),
    listTeamMembers: vi.fn(),
    createTeam: vi.fn(),
    joinTeam: vi.fn(),
    deleteTeam: vi.fn(),
    removeTeamMember: vi.fn(),
    createTeamInvite: vi.fn(),
    listTeamInvites: vi.fn(),
    deleteTeamInvite: vi.fn(),
    updateContextPack: vi.fn(),
    createDiaryGrant: vi.fn(),
    listDiaryGrants: vi.fn(),
    revokeDiaryGrant: vi.fn(),
    listTasks: vi.fn(),
    createTask: vi.fn(),
    claimTask: vi.fn(),
    taskHeartbeat: vi.fn(),
    completeTask: vi.fn(),
    cancelTask: vi.fn(),
    listTaskAttempts: vi.fn(),
    listTaskMessages: vi.fn(),
    appendTaskMessages: vi.fn(),
  };
});

const mockClient = {} as Client;
const mockTokenManager = {
  getToken: vi.fn().mockResolvedValue('test-token'),
  invalidate: vi.fn(),
} as unknown as TokenManager;
const mockAuth = () => Promise.resolve('test-token');

function makeAgent() {
  return createAgent({
    client: mockClient,
    tokenManager: mockTokenManager,
    auth: mockAuth,
  });
}

const mockEntry = {
  id: 'entry-1',
  diaryId: 'diary-1',
  title: 'Test',
  content: 'Hello',
  tags: null,
  injectionRisk: false,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
};

const problemError = {
  type: 'https://themolt.net/problems/not-found',
  title: 'Not Found',
  status: 404,
  code: 'NOT_FOUND' as const,
  detail: 'Entry not found',
};

const mockTask = {
  id: 'task-1',
  taskType: 'fulfill_brief',
  teamId: 'team-1',
  diaryId: 'diary-1',
  outputKind: 'artifact',
  input: { brief: 'Hello' },
  inputSchemaCid: 'cid-schema',
  inputCid: 'cid-input',
  criteriaCid: null,
  references: [],
  correlationId: null,
  imposedByAgentId: null,
  imposedByHumanId: null,
  acceptedAttemptN: null,
  status: 'queued',
  queuedAt: '2024-01-01T00:00:00Z',
  completedAt: null,
  expiresAt: null,
  cancelledByAgentId: null,
  cancelledByHumanId: null,
  cancelReason: null,
  maxAttempts: 1,
};

describe('Agent facade', () => {
  // -----------------------------------------------------------------------
  // diary
  // -----------------------------------------------------------------------
  describe('diary', () => {
    it('diary.create calls createDiaryEntry and returns data', async () => {
      vi.mocked(createDiaryEntry).mockResolvedValueOnce({
        data: mockEntry,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.entries.create('my-diary', {
        content: 'Hello',
      });

      expect(result).toEqual(mockEntry);
      expect(createDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          client: mockClient,
          auth: mockAuth,
          body: { content: 'Hello' },
          path: { diaryId: 'my-diary' },
        }),
      );
    });

    it('diary.create throws MoltNetError on error', async () => {
      vi.mocked(createDiaryEntry).mockResolvedValueOnce({
        data: undefined,
        error: problemError,
      } as any);

      const agent = makeAgent();
      await expect(
        agent.entries.create('my-diary', { content: 'x' }),
      ).rejects.toThrow(MoltNetError);
    });

    it('diary.list calls listDiaryEntries', async () => {
      const listData = {
        items: [mockEntry],
        total: 1,
        limit: 10,
        offset: 0,
      };
      vi.mocked(listDiaryEntries).mockResolvedValueOnce({
        data: listData,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.entries.list('my-diary', { limit: 10 });

      expect(result).toEqual(listData);
      expect(listDiaryEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { limit: 10 },
          path: { diaryId: 'my-diary' },
        }),
      );
    });

    it('diary.get passes entry id as path param', async () => {
      vi.mocked(getDiaryEntryById).mockResolvedValueOnce({
        data: mockEntry,
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.entries.get('entry-1');

      expect(getDiaryEntryById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { entryId: 'entry-1' },
        }),
      );
    });

    it('diary.update passes entry id and body', async () => {
      vi.mocked(updateDiaryEntryById).mockResolvedValueOnce({
        data: mockEntry,
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.entries.update('entry-1', {
        content: 'Updated',
      });

      expect(updateDiaryEntryById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { entryId: 'entry-1' },
          body: { content: 'Updated' },
        }),
      );
    });

    it('diary.delete passes entry id as path param', async () => {
      vi.mocked(deleteDiaryEntryById).mockResolvedValueOnce({
        data: { success: true },
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.entries.delete('entry-1');

      expect(result).toEqual({ success: true });
      expect(deleteDiaryEntryById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { entryId: 'entry-1' },
        }),
      );
    });

    it('diary.search passes body', async () => {
      const searchData = { results: [mockEntry], total: 1 };
      vi.mocked(searchDiary).mockResolvedValueOnce({
        data: searchData,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.entries.search({ query: 'hello' });

      expect(result).toEqual(searchData);
      expect(searchDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { query: 'hello' },
        }),
      );
    });

    it('diary.reflect passes query', async () => {
      const digest = {
        entries: [],
        totalEntries: 0,
        periodDays: 7,
        generatedAt: '2024-01-01',
      };
      vi.mocked(reflectDiary).mockResolvedValueOnce({
        data: digest,
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.entries.reflect({ diaryId: 'my-diary', days: 7 });

      expect(reflectDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { diaryId: 'my-diary', days: 7 },
        }),
      );
    });

    it('diary.verify passes entry id as path param', async () => {
      vi.mocked(verifyDiaryEntryById).mockResolvedValueOnce({
        data: { signed: false, hashMatches: false, signatureValid: false },
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.entries.verify('entry-1');

      expect(verifyDiaryEntryById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { entryId: 'entry-1' },
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // tasks
  // -----------------------------------------------------------------------
  describe('tasks', () => {
    it('tasks.list calls listTasks', async () => {
      const taskList = { items: [mockTask], total: 1, nextCursor: null };
      vi.mocked(listTasks).mockResolvedValueOnce({
        data: taskList,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.tasks.list({ teamId: 'team-1' });

      expect(result).toEqual(taskList);
      expect(listTasks).toHaveBeenCalledWith(
        expect.objectContaining({
          client: mockClient,
          auth: mockAuth,
          query: { teamId: 'team-1' },
        }),
      );
    });

    it('tasks.create calls createTask', async () => {
      vi.mocked(createTask).mockResolvedValueOnce({
        data: mockTask,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.tasks.create({
        taskType: 'fulfill_brief',
        teamId: 'team-1',
        diaryId: 'diary-1',
        input: { brief: 'Hello' },
      });

      expect(result).toEqual(mockTask);
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          client: mockClient,
          auth: mockAuth,
          body: {
            taskType: 'fulfill_brief',
            teamId: 'team-1',
            diaryId: 'diary-1',
            input: { brief: 'Hello' },
          },
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // agents
  // -----------------------------------------------------------------------
  describe('agents', () => {
    it('agents.whoami calls getWhoami', async () => {
      const whoami = {
        identityId: 'id-1',
        publicKey: 'pk',
        fingerprint: 'fp',
        clientId: 'cid',
      };
      vi.mocked(getWhoami).mockResolvedValueOnce({
        data: whoami,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.agents.whoami();

      expect(result).toEqual(whoami);
      expect(getWhoami).toHaveBeenCalledWith(
        expect.objectContaining({ client: mockClient }),
      );
    });

    it('agents.lookup passes fingerprint as path param', async () => {
      const profile = { publicKey: 'pk', fingerprint: 'A1B2-C3D4' };
      vi.mocked(getAgentProfile).mockResolvedValueOnce({
        data: profile,
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.agents.lookup('A1B2-C3D4');

      expect(getAgentProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { fingerprint: 'A1B2-C3D4' },
        }),
      );
    });

    it('agents.verifySignature passes fingerprint and body', async () => {
      vi.mocked(verifyAgentSignature).mockResolvedValueOnce({
        data: { valid: true },
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.agents.verifySignature('A1B2', {
        signature: 'sig',
      });

      expect(verifyAgentSignature).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { fingerprint: 'A1B2' },
          body: { signature: 'sig' },
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // crypto
  // -----------------------------------------------------------------------
  describe('crypto', () => {
    it('crypto.identity calls getCryptoIdentity', async () => {
      const identity = {
        identityId: 'id-1',
        publicKey: 'pk',
        fingerprint: 'fp',
      };
      vi.mocked(getCryptoIdentity).mockResolvedValueOnce({
        data: identity,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.crypto.identity();

      expect(result).toEqual(identity);
    });

    it('crypto.verify passes body', async () => {
      vi.mocked(verifyCryptoSignature).mockResolvedValueOnce({
        data: { valid: true },
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.crypto.verify({
        signature: 'sig',
      });

      expect(verifyCryptoSignature).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { signature: 'sig' },
        }),
      );
    });

    it('crypto.signingRequests.list calls listSigningRequests', async () => {
      const listData = {
        items: [],
        total: 0,
        limit: 10,
        offset: 0,
      };
      vi.mocked(listSigningRequests).mockResolvedValueOnce({
        data: listData,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.crypto.signingRequests.list();

      expect(result).toEqual(listData);
    });

    it('crypto.signingRequests.create passes body', async () => {
      const sr = {
        id: 'sr-1',
        agentId: 'a-1',
        message: 'msg',
        nonce: 'n',
        status: 'pending',
        signature: null,
        valid: null,
        createdAt: '2024-01-01',
        expiresAt: '2024-01-02',
        completedAt: null,
      };
      vi.mocked(createSigningRequest).mockResolvedValueOnce({
        data: sr,
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.crypto.signingRequests.create({ message: 'msg' });

      expect(createSigningRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { message: 'msg' },
        }),
      );
    });

    it('crypto.signingRequests.get passes id', async () => {
      vi.mocked(getSigningRequest).mockResolvedValueOnce({
        data: { id: 'sr-1' },
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.crypto.signingRequests.get('sr-1');

      expect(getSigningRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'sr-1' },
        }),
      );
    });

    it('crypto.signingRequests.submit passes id and body', async () => {
      vi.mocked(submitSignature).mockResolvedValueOnce({
        data: { id: 'sr-1' },
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.crypto.signingRequests.submit('sr-1', {
        signature: 'sig',
      });

      expect(submitSignature).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'sr-1' },
          body: { signature: 'sig' },
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // vouch
  // -----------------------------------------------------------------------
  describe('vouch', () => {
    it('vouch.issue calls issueVoucher', async () => {
      const voucher = {
        code: 'abc',
        expiresAt: '2024-12-31',
        issuedBy: 'fp',
      };
      vi.mocked(issueVoucher).mockResolvedValueOnce({
        data: voucher,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.vouch.issue();

      expect(result).toEqual(voucher);
    });

    it('vouch.listActive calls listActiveVouchers', async () => {
      vi.mocked(listActiveVouchers).mockResolvedValueOnce({
        data: { vouchers: [] },
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.vouch.listActive();

      expect(listActiveVouchers).toHaveBeenCalled();
    });

    it('vouch.trustGraph calls getTrustGraph', async () => {
      vi.mocked(getTrustGraph).mockResolvedValueOnce({
        data: { edges: [] },
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.vouch.trustGraph();

      expect(getTrustGraph).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // auth
  // -----------------------------------------------------------------------
  describe('auth', () => {
    it('auth.rotateSecret calls rotateClientSecret', async () => {
      const rotated = { clientId: 'cid', clientSecret: 'new-secret' };
      vi.mocked(rotateClientSecret).mockResolvedValueOnce({
        data: rotated,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.auth.rotateSecret();

      expect(result).toEqual(rotated);
    });
  });

  // -----------------------------------------------------------------------
  // recovery
  // -----------------------------------------------------------------------
  describe('recovery', () => {
    it('recovery.requestChallenge calls requestRecoveryChallenge', async () => {
      const challenge = { challenge: 'ch', hmac: 'hm' };
      vi.mocked(requestRecoveryChallenge).mockResolvedValueOnce({
        data: challenge,
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.recovery.requestChallenge({ publicKey: 'pk' });

      expect(requestRecoveryChallenge).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { publicKey: 'pk' },
        }),
      );
    });

    it('recovery.verifyChallenge calls verifyRecoveryChallenge', async () => {
      vi.mocked(verifyRecoveryChallenge).mockResolvedValueOnce({
        data: { recoveryCode: 'code', recoveryFlowUrl: 'url' },
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.recovery.verifyChallenge({
        challenge: 'ch',
        hmac: 'hm',
        signature: 'sig',
        publicKey: 'pk',
      });

      expect(verifyRecoveryChallenge).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            challenge: 'ch',
            hmac: 'hm',
            signature: 'sig',
            publicKey: 'pk',
          },
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // public
  // -----------------------------------------------------------------------
  describe('public', () => {
    it('public.feed calls getPublicFeed', async () => {
      vi.mocked(getPublicFeed).mockResolvedValueOnce({
        data: { items: [], nextCursor: null },
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.public.feed({ limit: 5 });

      expect(result).toEqual({ items: [], nextCursor: null });
      expect(getPublicFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { limit: 5 },
        }),
      );
    });

    it('public.searchFeed calls searchPublicFeed', async () => {
      vi.mocked(searchPublicFeed).mockResolvedValueOnce({
        data: { items: [], query: 'test' },
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.public.searchFeed({ q: 'test' });

      expect(searchPublicFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { q: 'test' },
        }),
      );
    });

    it('public.entry passes id as path param', async () => {
      vi.mocked(getPublicEntry).mockResolvedValueOnce({
        data: { id: 'e-1' },
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.public.entry('e-1');

      expect(getPublicEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'e-1' },
        }),
      );
    });

    it('public.networkInfo calls getNetworkInfo', async () => {
      vi.mocked(getNetworkInfo).mockResolvedValueOnce({
        data: { network: { name: 'MoltNet' } },
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.public.networkInfo();

      expect(getNetworkInfo).toHaveBeenCalled();
    });

    it('public.llmsTxt calls getLlmsTxt', async () => {
      vi.mocked(getLlmsTxt).mockResolvedValueOnce({
        data: '# MoltNet',
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.public.llmsTxt();

      expect(result).toBe('# MoltNet');
    });

    it('public.health calls getHealth', async () => {
      vi.mocked(getHealth).mockResolvedValueOnce({
        data: { status: 'ok' },
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.public.health();

      expect(result).toEqual({ status: 'ok' });
      expect(getHealth).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // diaries
  // -----------------------------------------------------------------------
  const mockDiary = {
    id: 'diary-1',
    createdBy: 'owner-1',
    teamId: '00000000-0000-4000-b000-000000000001',
    name: 'My Diary',
    visibility: 'private' as const,
    signed: false,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };

  describe('diaries', () => {
    it('diaries.list calls listDiaries', async () => {
      vi.mocked(listDiaries).mockResolvedValueOnce({
        data: { items: [mockDiary] },
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.diaries.list();

      expect(result).toEqual({ items: [mockDiary] });
      expect(listDiaries).toHaveBeenCalledWith(
        expect.objectContaining({ client: mockClient }),
      );
    });

    it('diaries.create passes body', async () => {
      vi.mocked(createDiary).mockResolvedValueOnce({
        data: mockDiary,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const headers = { 'x-moltnet-team-id': 'team-123' };
      await agent.diaries.create({ name: 'My Diary' }, headers);

      expect(createDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { name: 'My Diary' },
          headers,
        }),
      );
    });

    it('diaries.get passes id as path param', async () => {
      vi.mocked(getDiary).mockResolvedValueOnce({
        data: mockDiary,
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.diaries.get('diary-1');

      expect(getDiary).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 'diary-1' } }),
      );
    });

    it('diaries.update passes id and body', async () => {
      vi.mocked(updateDiary).mockResolvedValueOnce({
        data: mockDiary,
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.diaries.update('diary-1', { name: 'Renamed' });

      expect(updateDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'diary-1' },
          body: { name: 'Renamed' },
        }),
      );
    });

    it('diaries.delete passes id as path param', async () => {
      vi.mocked(deleteDiary).mockResolvedValueOnce({
        data: { success: true },
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.diaries.delete('diary-1');

      expect(deleteDiary).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 'diary-1' } }),
      );
    });

    it('diaries.consolidate passes id and body', async () => {
      vi.mocked(consolidateDiary).mockResolvedValueOnce({
        data: {
          clusters: [],
          stats: { inputCount: 0, clusterCount: 0, elapsedMs: 0 },
          trace: { thresholdUsed: 0.2, strategyUsed: 'centroid' },
          workflowId: 'wf-1',
        },
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.diaries.consolidate('diary-1', {
        threshold: 0.2,
        strategy: 'centroid',
      });

      expect(consolidateDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'diary-1' },
          body: { threshold: 0.2, strategy: 'centroid' },
        }),
      );
    });

    it('diaries.compile passes id and body', async () => {
      vi.mocked(compileDiary).mockResolvedValueOnce({
        data: {
          entries: [],
          stats: { tokenBudget: 1000, usedTokens: 0, elapsedMs: 0 },
          trace: { lambdaUsed: 0.5, selectedCount: 0 },
          workflowId: 'wf-2',
        },
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.diaries.compile('diary-1', {
        query: 'auth flow',
        tokenBudget: 1000,
      });

      expect(compileDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'diary-1' },
          body: { query: 'auth flow', tokenBudget: 1000 },
        }),
      );
    });

    it('diaries.list throws on error', async () => {
      vi.mocked(listDiaries).mockResolvedValueOnce({
        data: undefined,
        error: problemError,
      } as any);

      const agent = makeAgent();
      await expect(agent.diaries.list()).rejects.toThrow(MoltNetError);
    });
  });

  // -----------------------------------------------------------------------
  // legreffier
  // -----------------------------------------------------------------------
  describe('legreffier', () => {
    it('legreffier.startOnboarding passes body', async () => {
      const response = {
        workflowId: 'wf-1',
        manifestUrl: 'https://example.com',
      };
      vi.mocked(startLegreffierOnboarding).mockResolvedValueOnce({
        data: response,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.legreffier.startOnboarding({
        publicKey: 'ed25519:abc',
        fingerprint: 'A1B2-C3D4',
        agentName: 'test-agent',
      });

      expect(result).toEqual(response);
      expect(startLegreffierOnboarding).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            publicKey: 'ed25519:abc',
            fingerprint: 'A1B2-C3D4',
            agentName: 'test-agent',
          },
        }),
      );
    });

    it('legreffier.getOnboardingStatus passes workflowId as path param', async () => {
      const status = { workflowId: 'wf-1', status: 'pending' };
      vi.mocked(getLegreffierOnboardingStatus).mockResolvedValueOnce({
        data: status,
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.legreffier.getOnboardingStatus('wf-1');

      expect(getLegreffierOnboardingStatus).toHaveBeenCalledWith(
        expect.objectContaining({ path: { workflowId: 'wf-1' } }),
      );
    });

    it('legreffier.startOnboarding throws on error', async () => {
      vi.mocked(startLegreffierOnboarding).mockResolvedValueOnce({
        data: undefined,
        error: problemError,
      } as any);

      const agent = makeAgent();
      await expect(
        agent.legreffier.startOnboarding({
          publicKey: 'ed25519:abc',
          fingerprint: 'A1B2-C3D4',
          agentName: 'test-agent',
        }),
      ).rejects.toThrow(MoltNetError);
    });
  });

  // -----------------------------------------------------------------------
  // problems
  // -----------------------------------------------------------------------
  describe('problems', () => {
    it('problems.list calls listProblemTypes', async () => {
      const types = [{ type: 'not-found', title: 'Not Found' }];
      vi.mocked(listProblemTypes).mockResolvedValueOnce({
        data: types,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.problems.list();

      expect(result).toEqual(types);
      expect(listProblemTypes).toHaveBeenCalled();
    });

    it('problems.get passes type as path param', async () => {
      const detail = {
        type: 'not-found',
        title: 'Not Found',
        description: '...',
      };
      vi.mocked(getProblemType).mockResolvedValueOnce({
        data: detail,
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.problems.get('not-found');

      expect(getProblemType).toHaveBeenCalledWith(
        expect.objectContaining({ path: { type: 'not-found' } }),
      );
    });

    it('problems.list throws MoltNetError when no data', async () => {
      vi.mocked(listProblemTypes).mockResolvedValueOnce({
        data: undefined,
        error: undefined,
      } as any);

      const agent = makeAgent();
      await expect(agent.problems.list()).rejects.toThrow(MoltNetError);
    });
  });

  // -----------------------------------------------------------------------
  // teams
  // -----------------------------------------------------------------------
  describe('teams', () => {
    it('teams.list calls listTeams', async () => {
      const teamsData = {
        items: [
          {
            id: 'team-1',
            name: 'Builders',
            personal: false,
            status: 'active',
            role: 'member',
          },
        ],
      };
      vi.mocked(listTeams).mockResolvedValueOnce({
        data: teamsData,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.teams.list();

      expect(result).toEqual(teamsData);
      expect(listTeams).toHaveBeenCalledWith(
        expect.objectContaining({ client: mockClient }),
      );
    });

    it('teams.get passes id as path param', async () => {
      const teamDetail = {
        id: 'team-1',
        name: 'Builders',
        status: 'active',
        personal: false,
        createdBy: 'owner-1',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        members: [{ subjectId: 'agent-1', subjectNs: 'Agent', role: 'member' }],
      };
      vi.mocked(getTeam).mockResolvedValueOnce({
        data: teamDetail,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.teams.get('team-1');

      expect(result).toEqual(teamDetail);
      expect(getTeam).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 'team-1' } }),
      );
    });

    it('teams.listMembers passes id as path param', async () => {
      const membersData = {
        items: [{ subjectId: 'agent-1', subjectNs: 'Agent', role: 'member' }],
      };
      vi.mocked(listTeamMembers).mockResolvedValueOnce({
        data: membersData,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.teams.listMembers('team-1');

      expect(result).toEqual(membersData);
      expect(listTeamMembers).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 'team-1' } }),
      );
    });

    it('teams.list throws MoltNetError on error', async () => {
      vi.mocked(listTeams).mockResolvedValueOnce({
        data: undefined,
        error: problemError,
      } as any);

      const agent = makeAgent();
      await expect(agent.teams.list()).rejects.toThrow(MoltNetError);
    });

    it('teams.create sends body', async () => {
      const created = { id: 'team-new', name: 'New Team' };
      vi.mocked(createTeam).mockResolvedValueOnce({
        data: created,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.teams.create({ name: 'New Team' });

      expect(result).toEqual(created);
      expect(createTeam).toHaveBeenCalledWith(
        expect.objectContaining({ body: { name: 'New Team' } }),
      );
    });

    it('teams.join sends code in body', async () => {
      const joined = { id: 'team-1', name: 'Builders' };
      vi.mocked(joinTeam).mockResolvedValueOnce({
        data: joined,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.teams.join('abc123');

      expect(result).toEqual(joined);
      expect(joinTeam).toHaveBeenCalledWith(
        expect.objectContaining({ body: { code: 'abc123' } }),
      );
    });

    it('teams.invites.create sends teamId and body', async () => {
      const invite = { code: 'inv-code', teamId: 'team-1' };
      vi.mocked(createTeamInvite).mockResolvedValueOnce({
        data: invite,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.teams.invites.create('team-1', {
        role: 'member',
      });

      expect(result).toEqual(invite);
      expect(createTeamInvite).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'team-1' },
          body: { role: 'member' },
        }),
      );
    });

    it('teams.invites.list sends teamId as path param', async () => {
      const invites = { items: [{ code: 'inv-1' }] };
      vi.mocked(listTeamInvites).mockResolvedValueOnce({
        data: invites,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.teams.invites.list('team-1');

      expect(result).toEqual(invites);
      expect(listTeamInvites).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 'team-1' } }),
      );
    });

    it('teams.delete calls deleteTeam with correct path', async () => {
      const deleted = { deleted: true };
      vi.mocked(deleteTeam).mockResolvedValueOnce({
        data: deleted,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.teams.delete('team-1');

      expect(result).toEqual(deleted);
      expect(deleteTeam).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 'team-1' } }),
      );
    });

    it('teams.removeMember calls removeTeamMember with correct path params', async () => {
      const removed = { removed: true };
      vi.mocked(removeTeamMember).mockResolvedValueOnce({
        data: removed,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.teams.removeMember('team-1', 'subject-1');

      expect(result).toEqual(removed);
      expect(removeTeamMember).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'team-1', subjectId: 'subject-1' },
        }),
      );
    });

    it('teams.invites.delete calls deleteTeamInvite with correct path params', async () => {
      const deleted = { deleted: true };
      vi.mocked(deleteTeamInvite).mockResolvedValueOnce({
        data: deleted,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.teams.invites.delete('team-1', 'invite-1');

      expect(result).toEqual(deleted);
      expect(deleteTeamInvite).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'team-1', inviteId: 'invite-1' },
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // packs
  // -----------------------------------------------------------------------
  describe('packs', () => {
    it('packs.update sends id and body', async () => {
      const updated = { id: 'pack-1', pinned: true };
      vi.mocked(updateContextPack).mockResolvedValueOnce({
        data: updated,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.packs.update('pack-1', { pinned: true });

      expect(result).toEqual(updated);
      expect(updateContextPack).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'pack-1' },
          body: { pinned: true },
        }),
      );
    });

    it('packs.update throws MoltNetError on error', async () => {
      vi.mocked(updateContextPack).mockResolvedValueOnce({
        data: undefined,
        error: problemError,
      } as any);

      const agent = makeAgent();
      await expect(
        agent.packs.update('pack-1', { pinned: true }),
      ).rejects.toThrow(MoltNetError);
    });
  });

  // -----------------------------------------------------------------------
  // diaryGrants
  // -----------------------------------------------------------------------
  describe('diaryGrants', () => {
    const grantBody = {
      subjectId: 'agent-1',
      subjectNs: 'Agent' as const,
      role: 'writer' as const,
    };

    it('diaryGrants.create passes diaryId and body', async () => {
      vi.mocked(createDiaryGrant).mockResolvedValueOnce({
        data: grantBody,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.diaryGrants.create('diary-1', grantBody);

      expect(result).toEqual(grantBody);
      expect(createDiaryGrant).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'diary-1' },
          body: grantBody,
        }),
      );
    });

    it('diaryGrants.list passes diaryId as path param', async () => {
      const grantsData = { grants: [grantBody] };
      vi.mocked(listDiaryGrants).mockResolvedValueOnce({
        data: grantsData,
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.diaryGrants.list('diary-1');

      expect(result).toEqual(grantsData);
      expect(listDiaryGrants).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 'diary-1' } }),
      );
    });

    it('diaryGrants.revoke passes diaryId and body', async () => {
      vi.mocked(revokeDiaryGrant).mockResolvedValueOnce({
        data: { revoked: true },
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.diaryGrants.revoke('diary-1', grantBody);

      expect(result).toEqual({ revoked: true });
      expect(revokeDiaryGrant).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'diary-1' },
          body: grantBody,
        }),
      );
    });

    it('diaryGrants.create throws MoltNetError on error', async () => {
      vi.mocked(createDiaryGrant).mockResolvedValueOnce({
        data: undefined,
        error: problemError,
      } as any);

      const agent = makeAgent();
      await expect(
        agent.diaryGrants.create('diary-1', grantBody),
      ).rejects.toThrow(MoltNetError);
    });
  });

  // -----------------------------------------------------------------------
  // getToken
  // -----------------------------------------------------------------------
  describe('getToken', () => {
    it('delegates to TokenManager.getToken()', async () => {
      const agent = makeAgent();
      const token = await agent.getToken();

      expect(token).toBe('test-token');
      expect(mockTokenManager.getToken).toHaveBeenCalled();
    });
  });
});
