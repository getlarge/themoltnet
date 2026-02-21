import type { Client } from '@moltnet/api-client';
import {
  createDiaryEntry,
  createSigningRequest,
  deleteDiaryEntry,
  getAgentProfile,
  getCryptoIdentity,
  getDiaryEntry,
  getLlmsTxt,
  getNetworkInfo,
  getPublicEntry,
  getPublicFeed,
  getSigningRequest,
  getTrustGraph,
  getWhoami,
  issueVoucher,
  listActiveVouchers,
  listDiaryEntries,
  listSigningRequests,
  reflectDiary,
  requestRecoveryChallenge,
  rotateClientSecret,
  searchDiary,
  searchPublicFeed,
  setDiaryEntryVisibility,
  submitSignature,
  updateDiaryEntry,
  verifyAgentSignature,
  verifyCryptoSignature,
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
    createDiaryEntry: vi.fn(),
    listDiaryEntries: vi.fn(),
    getDiaryEntry: vi.fn(),
    updateDiaryEntry: vi.fn(),
    deleteDiaryEntry: vi.fn(),
    searchDiary: vi.fn(),
    reflectDiary: vi.fn(),
    setDiaryEntryVisibility: vi.fn(),
    getWhoami: vi.fn(),
    getAgentProfile: vi.fn(),
    verifyAgentSignature: vi.fn(),
    getCryptoIdentity: vi.fn(),
    verifyCryptoSignature: vi.fn(),
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
  ownerId: 'owner-1',
  title: 'Test',
  content: 'Hello',
  visibility: 'private' as const,
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
      const result = await agent.diary.create('my-diary', {
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
        agent.diary.create('my-diary', { content: 'x' }),
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
      const result = await agent.diary.list('my-diary', { limit: 10 });

      expect(result).toEqual(listData);
      expect(listDiaryEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { limit: 10 },
          path: { diaryId: 'my-diary' },
        }),
      );
    });

    it('diary.get passes id as path param', async () => {
      vi.mocked(getDiaryEntry).mockResolvedValueOnce({
        data: mockEntry,
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.diary.get('my-diary', 'entry-1');

      expect(getDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryId: 'my-diary', entryId: 'entry-1' },
        }),
      );
    });

    it('diary.update passes id and body', async () => {
      vi.mocked(updateDiaryEntry).mockResolvedValueOnce({
        data: mockEntry,
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.diary.update('my-diary', 'entry-1', {
        content: 'Updated',
      });

      expect(updateDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryId: 'my-diary', entryId: 'entry-1' },
          body: { content: 'Updated' },
        }),
      );
    });

    it('diary.delete passes id as path param', async () => {
      vi.mocked(deleteDiaryEntry).mockResolvedValueOnce({
        data: { success: true },
        error: undefined,
      } as any);

      const agent = makeAgent();
      const result = await agent.diary.delete('my-diary', 'entry-1');

      expect(result).toEqual({ success: true });
      expect(deleteDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryId: 'my-diary', entryId: 'entry-1' },
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
      const result = await agent.diary.search({ query: 'hello' });

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
      await agent.diary.reflect({ days: 7 });

      expect(reflectDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { days: 7 },
        }),
      );
    });

    it('diary.setVisibility passes id and body', async () => {
      vi.mocked(setDiaryEntryVisibility).mockResolvedValueOnce({
        data: { ...mockEntry, visibility: 'public' },
        error: undefined,
      } as any);

      const agent = makeAgent();
      await agent.diary.setVisibility('my-diary', 'entry-1', {
        visibility: 'public',
      });

      expect(setDiaryEntryVisibility).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryId: 'my-diary', entryId: 'entry-1' },
          body: { visibility: 'public' },
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
