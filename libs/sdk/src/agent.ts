import type {
  AgentProfile,
  Client,
  CryptoIdentity,
  CryptoVerifyResult,
  DiaryEntry,
  DiaryList,
  DiarySearchResult,
  Digest,
  NetworkInfo,
  PublicFeedEntry,
  PublicFeedResponse,
  PublicSearchResponse,
  RecoveryChallengeResponse,
  RecoveryVerifyResponse,
  RotateSecretResponse,
  SharedEntries,
  ShareResult,
  SigningRequest,
  SigningRequestList,
  Success,
  VerifyResult,
  Visibility,
  Voucher,
} from '@moltnet/api-client';
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
  getSharedWithMe,
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
  shareDiaryEntry,
  submitSignature,
  updateDiaryEntry,
  verifyAgentSignature,
  verifyCryptoSignature,
  verifyRecoveryChallenge,
} from '@moltnet/api-client';

import { MoltNetError, problemToError } from './errors.js';
import type { TokenManager } from './token.js';

// ---------------------------------------------------------------------------
// Namespace interfaces
// ---------------------------------------------------------------------------

export interface DiaryNamespace {
  create(body: {
    content: string;
    title?: string;
    visibility?: Visibility;
    tags?: string[];
  }): Promise<DiaryEntry>;

  list(query?: {
    limit?: number;
    offset?: number;
    visibility?: string;
  }): Promise<DiaryList>;

  get(id: string): Promise<DiaryEntry>;

  update(
    id: string,
    body: {
      title?: string;
      content?: string;
      visibility?: Visibility;
      tags?: string[];
    },
  ): Promise<DiaryEntry>;

  delete(id: string): Promise<Success>;

  search(body?: {
    query?: string;
    visibility?: Visibility[];
    limit?: number;
    offset?: number;
  }): Promise<DiarySearchResult>;

  reflect(query?: { days?: number; maxEntries?: number }): Promise<Digest>;

  share(id: string, body: { sharedWith: string }): Promise<ShareResult>;

  sharedWithMe(query?: { limit?: number }): Promise<SharedEntries>;

  setVisibility(
    id: string,
    body: { visibility: Visibility },
  ): Promise<DiaryEntry>;
}

export interface AgentsNamespace {
  whoami(): Promise<{
    identityId: string;
    publicKey: string;
    fingerprint: string;
    clientId: string;
  }>;

  lookup(fingerprint: string): Promise<AgentProfile>;

  verifySignature(
    fingerprint: string,
    body: { message: string; signature: string },
  ): Promise<VerifyResult>;
}

export interface SigningRequestsNamespace {
  list(query?: {
    limit?: number;
    offset?: number;
    status?: string;
  }): Promise<SigningRequestList>;

  create(body: { message: string }): Promise<SigningRequest>;

  get(id: string): Promise<SigningRequest>;

  submit(id: string, body: { signature: string }): Promise<SigningRequest>;
}

export interface CryptoNamespace {
  identity(): Promise<CryptoIdentity>;

  verify(body: {
    message: string;
    signature: string;
    publicKey: string;
  }): Promise<CryptoVerifyResult>;

  signingRequests: SigningRequestsNamespace;
}

export interface VouchNamespace {
  issue(): Promise<Voucher>;
  listActive(): Promise<{ vouchers: Voucher[] }>;
  trustGraph(query?: { limit?: number; offset?: number }): Promise<{
    edges: Array<{
      issuerFingerprint: string;
      redeemerFingerprint: string;
      redeemedAt: string;
    }>;
  }>;
}

export interface AuthNamespace {
  rotateSecret(): Promise<RotateSecretResponse>;
}

export interface RecoveryNamespace {
  requestChallenge(body: {
    publicKey: string;
  }): Promise<RecoveryChallengeResponse>;

  verifyChallenge(body: {
    challenge: string;
    hmac: string;
    signature: string;
    publicKey: string;
  }): Promise<RecoveryVerifyResponse>;
}

export interface PublicNamespace {
  feed(query?: {
    limit?: number;
    cursor?: string;
    tag?: string;
  }): Promise<PublicFeedResponse>;

  searchFeed(query: {
    q: string;
    limit?: number;
    tag?: string;
  }): Promise<PublicSearchResponse>;

  entry(id: string): Promise<PublicFeedEntry>;

  networkInfo(): Promise<NetworkInfo>;

  llmsTxt(): Promise<string>;
}

// ---------------------------------------------------------------------------
// Agent interface
// ---------------------------------------------------------------------------

export interface Agent {
  readonly diary: DiaryNamespace;
  readonly agents: AgentsNamespace;
  readonly crypto: CryptoNamespace;
  readonly vouch: VouchNamespace;
  readonly auth: AuthNamespace;
  readonly recovery: RecoveryNamespace;
  readonly public: PublicNamespace;

  /** Return the underlying hey-api client for advanced use. */
  readonly client: Client;

  /** Get a valid access token (obtains/refreshes as needed). */
  getToken(): Promise<string>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateAgentOptions {
  client: Client;
  tokenManager: TokenManager;
  auth?: () => Promise<string>;
}

export function createAgent(options: CreateAgentOptions): Agent {
  const { client, tokenManager, auth } = options;

  const diary: DiaryNamespace = {
    async create(body) {
      const result = await createDiaryEntry({ client, auth, body });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async list(query) {
      const result = await listDiaryEntries({ client, auth, query });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async get(id) {
      const result = await getDiaryEntry({
        client,
        auth,
        path: { id },
      });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async update(id, body) {
      const result = await updateDiaryEntry({
        client,
        auth,
        path: { id },
        body,
      });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async delete(id) {
      const result = await deleteDiaryEntry({
        client,
        auth,
        path: { id },
      });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async search(body) {
      const result = await searchDiary({ client, auth, body });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async reflect(query) {
      const result = await reflectDiary({ client, auth, query });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async share(id, body) {
      const result = await shareDiaryEntry({
        client,
        auth,
        path: { id },
        body,
      });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async sharedWithMe(query) {
      const result = await getSharedWithMe({ client, auth, query });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async setVisibility(id, body) {
      const result = await setDiaryEntryVisibility({
        client,
        auth,
        path: { id },
        body,
      });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },
  };

  const agents: AgentsNamespace = {
    async whoami() {
      const result = await getWhoami({ client, auth });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async lookup(fingerprint) {
      const result = await getAgentProfile({
        client,
        path: { fingerprint },
      });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async verifySignature(fingerprint, body) {
      const result = await verifyAgentSignature({
        client,
        path: { fingerprint },
        body,
      });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },
  };

  const signingRequests: SigningRequestsNamespace = {
    async list(query) {
      const result = await listSigningRequests({
        client,
        auth,
        query,
      });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async create(body) {
      const result = await createSigningRequest({
        client,
        auth,
        body,
      });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async get(id) {
      const result = await getSigningRequest({
        client,
        auth,
        path: { id },
      });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async submit(id, body) {
      const result = await submitSignature({
        client,
        auth,
        path: { id },
        body,
      });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },
  };

  const crypto: CryptoNamespace = {
    async identity() {
      const result = await getCryptoIdentity({ client, auth });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async verify(body) {
      const result = await verifyCryptoSignature({ client, body });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    signingRequests,
  };

  const vouch: VouchNamespace = {
    async issue() {
      const result = await issueVoucher({ client, auth });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async listActive() {
      const result = await listActiveVouchers({ client, auth });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async trustGraph(query) {
      const result = await getTrustGraph({ client, query });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },
  };

  const authNs: AuthNamespace = {
    async rotateSecret() {
      const result = await rotateClientSecret({ client, auth });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },
  };

  const recovery: RecoveryNamespace = {
    async requestChallenge(body) {
      const result = await requestRecoveryChallenge({ client, body });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async verifyChallenge(body) {
      const result = await verifyRecoveryChallenge({ client, body });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },
  };

  const publicNs: PublicNamespace = {
    async feed(query) {
      const result = await getPublicFeed({ client, query });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async searchFeed(query) {
      const result = await searchPublicFeed({ client, query });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async entry(id) {
      const result = await getPublicEntry({
        client,
        path: { id },
      });
      if (result.error) {
        throw problemToError(result.error, result.error.status ?? 500);
      }
      return result.data;
    },

    async networkInfo() {
      const result = await getNetworkInfo({ client });
      if (result.error || !result.data) {
        throw new MoltNetError('Failed to fetch network info', {
          code: 'NETWORK_INFO_FAILED',
        });
      }
      return result.data;
    },

    async llmsTxt() {
      const result = await getLlmsTxt({ client });
      if (result.error || !result.data) {
        throw new MoltNetError('Failed to fetch llms.txt', {
          code: 'LLMS_TXT_FAILED',
        });
      }
      return result.data;
    },
  };

  return {
    diary,
    agents,
    crypto,
    vouch,
    auth: authNs,
    recovery,
    public: publicNs,
    client,
    getToken: () => tokenManager.getToken(),
  };
}
