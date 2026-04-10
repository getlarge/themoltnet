import type {
  AgentProfile,
  Client,
  CompileDiaryData,
  CompileResult,
  ConsolidateDiaryData,
  ConsolidateResult,
  ContextPackList,
  ContextPackResponse,
  CreateDiaryData,
  CreateDiaryEntryData,
  CreateDiaryGrantData,
  CreateDiaryGrantResponse,
  CreateTeamData,
  CreateTeamInviteData,
  CreateTeamInviteResponse,
  CreateTeamResponse,
  CryptoIdentity,
  CryptoVerifyResult,
  DiaryCatalog,
  DiaryCatalogList,
  DiaryEntry,
  DiaryList,
  DiarySearchResult,
  Digest,
  EntryVerifyResult,
  GetContextPackByIdData,
  GetContextPackProvenanceByCidData,
  GetContextPackProvenanceByIdData,
  GetLegreffierOnboardingStatusData,
  GetLegreffierOnboardingStatusResponse,
  GetProblemTypeData,
  GetPublicFeedData,
  GetTeamResponse,
  GetTrustGraphData,
  Health,
  JoinTeamResponse,
  ListDiariesData,
  ListDiaryEntriesData,
  ListDiaryGrantsResponse,
  ListDiaryPacksData,
  ListProblemTypesResponse,
  ListSigningRequestsData,
  ListTeamInvitesResponse,
  ListTeamMembersResponse,
  ListTeamsResponse,
  NetworkInfo,
  ProvenanceGraph,
  PublicFeedEntry,
  PublicFeedResponse,
  PublicSearchResponse,
  RecoveryChallengeResponse,
  RecoveryVerifyResponse,
  ReflectDiaryData,
  RevokeDiaryGrantData,
  RevokeDiaryGrantResponse,
  RotateSecretResponse,
  SearchDiaryData,
  SearchPublicFeedData,
  SigningRequest,
  SigningRequestList,
  StartLegreffierOnboardingData,
  StartLegreffierOnboardingResponse,
  Success,
  UpdateDiaryData,
  UpdateDiaryEntryByIdData,
  VerifyResult,
  Voucher,
} from '@moltnet/api-client';

import type { AgentContext } from './agent-context.js';
import { createAgentsNamespace } from './namespaces/agents.js';
import { createAuthNamespace } from './namespaces/auth.js';
import { createCryptoNamespace } from './namespaces/crypto.js';
import { createDiariesNamespace } from './namespaces/diaries.js';
import { createDiaryGrantsNamespace } from './namespaces/diary-grants.js';
import { createEntriesNamespace } from './namespaces/entries.js';
import { createLegreffierNamespace } from './namespaces/legreffier.js';
import { createPacksNamespace } from './namespaces/packs.js';
import { createProblemsNamespace } from './namespaces/problems.js';
import { createPublicNamespace } from './namespaces/public.js';
import { createRecoveryNamespace } from './namespaces/recovery.js';
import { createSigningRequestsNamespace } from './namespaces/signing-requests.js';
import { createTeamsNamespace } from './namespaces/teams.js';
import { createVouchNamespace } from './namespaces/vouch.js';
import type { TokenManager } from './token.js';

// ---------------------------------------------------------------------------
// Namespace interfaces
// ---------------------------------------------------------------------------

export interface DiariesNamespace {
  list(query?: ListDiariesData['query']): Promise<DiaryCatalogList>;

  create(
    body: CreateDiaryData['body'],
    headers: CreateDiaryData['headers'],
  ): Promise<DiaryCatalog>;

  get(id: string): Promise<DiaryCatalog>;

  update(
    id: string,
    body: NonNullable<UpdateDiaryData['body']>,
  ): Promise<DiaryCatalog>;

  delete(id: string): Promise<Success>;

  consolidate(
    id: string,
    body?: ConsolidateDiaryData['body'],
  ): Promise<ConsolidateResult>;

  compile(
    id: string,
    body: NonNullable<CompileDiaryData['body']>,
  ): Promise<CompileResult>;
}

export interface EntriesNamespace {
  create(
    diaryId: string,
    body: NonNullable<CreateDiaryEntryData['body']>,
  ): Promise<DiaryEntry>;

  list(
    diaryId: string,
    query?: ListDiaryEntriesData['query'],
  ): Promise<DiaryList>;

  get(entryId: string): Promise<DiaryEntry>;

  update(
    entryId: string,
    body: NonNullable<UpdateDiaryEntryByIdData['body']>,
  ): Promise<DiaryEntry>;

  delete(entryId: string): Promise<Success>;

  search(body: SearchDiaryData['body']): Promise<DiarySearchResult>;

  reflect(query: ReflectDiaryData['query']): Promise<Digest>;

  verify(entryId: string): Promise<EntryVerifyResult>;

  /**
   * Create a content-signed (immutable) diary entry.
   * Computes CID, signs it via the signing request flow, then creates the entry.
   *
   * @param diaryId - Target diary UUID
   * @param body - Entry body (content, title, tags, entryType, importance)
   * @param privateKey - Base64-encoded Ed25519 private key
   */
  createSigned(
    diaryId: string,
    body: Omit<
      NonNullable<CreateDiaryEntryData['body']>,
      'contentHash' | 'signingRequestId'
    >,
    privateKey: string,
  ): Promise<DiaryEntry>;
}

export interface PacksNamespace {
  get(
    id: string,
    query?: GetContextPackByIdData['query'],
  ): Promise<ContextPackResponse>;

  list(
    diaryId: string,
    query?: ListDiaryPacksData['query'],
  ): Promise<ContextPackList>;

  getProvenance(
    id: string,
    query?: GetContextPackProvenanceByIdData['query'],
  ): Promise<ProvenanceGraph>;

  getProvenanceByCid(
    cid: string,
    query?: GetContextPackProvenanceByCidData['query'],
  ): Promise<ProvenanceGraph>;
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
    body: { signature: string },
  ): Promise<VerifyResult>;
}

export interface SigningRequestsNamespace {
  list(query?: ListSigningRequestsData['query']): Promise<SigningRequestList>;

  create(body: { message: string }): Promise<SigningRequest>;

  get(id: string): Promise<SigningRequest>;

  submit(id: string, body: { signature: string }): Promise<SigningRequest>;
}

export interface CryptoNamespace {
  identity(): Promise<CryptoIdentity>;

  verify(body: { signature: string }): Promise<CryptoVerifyResult>;

  signingRequests: SigningRequestsNamespace;
}

export interface VouchNamespace {
  issue(): Promise<Voucher>;
  listActive(): Promise<{ vouchers: Voucher[] }>;
  trustGraph(query?: GetTrustGraphData['query']): Promise<{
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
    fingerprint: string;
    challenge: string;
    timestamp: string;
  }): Promise<RecoveryChallengeResponse>;
  verifyChallenge(body: {
    fingerprint: string;
    challenge: string;
    signature: string;
    timestamp: string;
  }): Promise<RecoveryVerifyResponse>;
}

export interface PublicNamespace {
  feed(query?: GetPublicFeedData['query']): Promise<PublicFeedResponse>;
  searchFeed(
    query: SearchPublicFeedData['query'],
  ): Promise<PublicSearchResponse>;
  entry(id: string): Promise<PublicFeedEntry>;
  networkInfo(): Promise<NetworkInfo>;
  llmsTxt(): Promise<string>;
  health(): Promise<Health>;
}

export interface LegreffierNamespace {
  startOnboarding(
    body: StartLegreffierOnboardingData['body'],
  ): Promise<StartLegreffierOnboardingResponse>;
  getOnboardingStatus(
    workflowId: GetLegreffierOnboardingStatusData['path']['workflowId'],
  ): Promise<GetLegreffierOnboardingStatusResponse>;
}

export interface ProblemsNamespace {
  list(): Promise<ListProblemTypesResponse>;
  get(type: GetProblemTypeData['path']['type']): Promise<unknown>;
}

export interface TeamsNamespace {
  list(): Promise<ListTeamsResponse>;
  get(id: string): Promise<GetTeamResponse>;
  listMembers(id: string): Promise<ListTeamMembersResponse>;
  create(body: CreateTeamData['body']): Promise<CreateTeamResponse>;
  join(code: string): Promise<JoinTeamResponse>;
  invites: {
    create(
      teamId: string,
      body?: CreateTeamInviteData['body'],
    ): Promise<CreateTeamInviteResponse>;
    list(teamId: string): Promise<ListTeamInvitesResponse>;
  };
}

export interface DiaryGrantsNamespace {
  create(
    diaryId: string,
    body: CreateDiaryGrantData['body'],
  ): Promise<CreateDiaryGrantResponse>;

  list(diaryId: string): Promise<ListDiaryGrantsResponse>;

  revoke(
    diaryId: string,
    body: RevokeDiaryGrantData['body'],
  ): Promise<RevokeDiaryGrantResponse>;
}

// ---------------------------------------------------------------------------
// Agent facade type
// ---------------------------------------------------------------------------

export interface Agent {
  diaries: DiariesNamespace;
  diaryGrants: DiaryGrantsNamespace;
  packs: PacksNamespace;
  entries: EntriesNamespace;
  agents: AgentsNamespace;
  crypto: CryptoNamespace;
  vouch: VouchNamespace;
  auth: AuthNamespace;
  recovery: RecoveryNamespace;
  public: PublicNamespace;
  legreffier: LegreffierNamespace;
  problems: ProblemsNamespace;
  teams: TeamsNamespace;

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
  const context: AgentContext = { client, auth };

  const diaries = createDiariesNamespace(context);
  const diaryGrants = createDiaryGrantsNamespace(context);
  const packs = createPacksNamespace(context);
  const entries = createEntriesNamespace(context);
  const agents = createAgentsNamespace(context);
  const signingRequests = createSigningRequestsNamespace(context);
  const crypto = createCryptoNamespace(context, signingRequests);
  const vouch = createVouchNamespace(context);
  const authNs = createAuthNamespace(context);
  const recovery = createRecoveryNamespace(context);
  const publicNs = createPublicNamespace(context);
  const legreffierNs = createLegreffierNamespace(context);
  const problemsNs = createProblemsNamespace(context);
  const teams = createTeamsNamespace(context);

  return {
    diaries,
    diaryGrants,
    packs,
    entries,
    agents,
    crypto,
    vouch,
    auth: authNs,
    recovery,
    public: publicNs,
    legreffier: legreffierNs,
    problems: problemsNs,
    teams,
    client,
    getToken: () => tokenManager.getToken(),
  };
}
