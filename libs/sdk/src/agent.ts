import type {
  AbortTaskAttemptData,
  AcceptTransferResponses,
  AgentProfile,
  AppendTaskMessagesData,
  BatchDeleteDiaryEntriesData,
  BatchDeleteResponse,
  BatchDeleteTasksData,
  BeginRuntimeSlotData,
  CancelTaskData,
  ClaimTaskData,
  ClaimTaskResponse,
  Client,
  CompleteTaskData,
  ContextPackResponse,
  ContextPackResponseListWithRendered,
  CreateDiaryCustomPackData,
  CreateDiaryData,
  CreateDiaryEntryData,
  CreateDiaryGrantData,
  CreateDiaryGrantResponse,
  CreateRuntimeProfileData,
  CreateTaskData,
  CreateTeamData,
  CreateTeamInviteData,
  CreateTeamInviteResponse,
  CreateTeamResponse,
  CryptoIdentity,
  CryptoVerifyResult,
  CustomPackResult,
  DeleteTeamInviteResponse,
  DeleteTeamResponse,
  DiaryCatalog,
  DiaryCatalogList,
  DiaryEntry,
  DiaryList,
  DiarySearchResult,
  DiaryTagsResponse,
  EntryVerifyResult,
  FailTaskData,
  FindLatestRuntimeSlotForAttemptData,
  FinishRuntimeSlotData,
  GetContextPackByIdData,
  GetContextPackProvenanceByCidData,
  GetContextPackProvenanceByIdData,
  GetLatestRenderedPackData,
  GetLegreffierOnboardingStatusData,
  GetLegreffierOnboardingStatusResponse,
  GetProblemTypeData,
  GetPublicFeedData,
  GetRenderedPackByIdData,
  GetTeamResponse,
  GetTrustGraphData,
  Health,
  HeartbeatResponse,
  InitiateTransferData,
  InitiateTransferResponses,
  JoinTeamResponse,
  ListContextPacksData,
  ListDiariesData,
  ListDiaryEntriesData,
  ListDiaryGrantsResponse,
  ListDiaryPacksData,
  ListDiaryRenderedPacksData,
  ListDiaryTagsData,
  ListPendingTransfersResponses,
  ListProblemTypesResponse,
  ListSigningRequestsData,
  ListTaskMessagesData,
  ListTaskSchemasResponse,
  ListTasksData,
  ListTeamInvitesResponse,
  ListTeamMembersResponse,
  ListTeamsResponse,
  NetworkInfo,
  PreviewDiaryCustomPackData,
  PreviewRenderedPackData,
  ProvenanceGraph,
  PublicFeedEntry,
  PublicFeedResponse,
  PublicSearchResponse,
  RecoveryChallengeResponse,
  RecoveryVerifyResponse,
  RejectTransferResponses,
  RemoveTeamMemberResponse,
  RenderContextPackData,
  RenderedPackList,
  RenderedPackPreview,
  RenderedPackResult,
  RenderedPackWithContent,
  RequestRecoveryChallengeData,
  ResolvedRuntimeSlot,
  RevokeDiaryGrantData,
  RevokeDiaryGrantResponse,
  RotateSecretResponse,
  RuntimeProfile,
  RuntimeProfileListResponse,
  RuntimeSlot,
  SearchDiaryData,
  SearchPublicFeedData,
  SigningRequest,
  SigningRequestList,
  StartLegreffierOnboardingData,
  StartLegreffierOnboardingResponse,
  Success,
  Task,
  TaskAttempt,
  TaskHeartbeatData,
  TaskListResponse,
  TaskMessage,
  UpdateContextPackData,
  UpdateDiaryData,
  UpdateDiaryEntryByIdData,
  UpdateRenderedPackData,
  UpdateRuntimeProfileData,
  UpdateTeamMemberRoleData,
  UpdateTeamMemberRoleResponse,
  VerifyRecoveryChallengeData,
  VerifyResult,
  Voucher,
} from '@moltnet/api-client';
import type {
  AssessBriefInput,
  CuratePackInput,
  FreeformInput,
  FulfillBriefInput,
  JudgeEvalAttemptInput,
  JudgePackInput,
  PrReviewInput,
  RenderPackInput,
  RunEvalInput,
} from '@moltnet/tasks';

import type { AgentContext } from './agent-context.js';
import { createAgentsNamespace } from './namespaces/agents.js';
import { createAuthNamespace } from './namespaces/auth.js';
import { createCryptoNamespace } from './namespaces/crypto.js';
import { createDiariesNamespace } from './namespaces/diaries.js';
import { createDiaryGrantsNamespace } from './namespaces/diary-grants.js';
import { createDiaryTransfersNamespace } from './namespaces/diary-transfers.js';
import { createEntriesNamespace } from './namespaces/entries.js';
import { createLegreffierNamespace } from './namespaces/legreffier.js';
import { createPacksNamespace } from './namespaces/packs.js';
import { createProblemsNamespace } from './namespaces/problems.js';
import { createPublicNamespace } from './namespaces/public.js';
import { createRecoveryNamespace } from './namespaces/recovery.js';
import { createRuntimeProfilesNamespace } from './namespaces/runtime-profiles.js';
import { createRuntimeSlotsNamespace } from './namespaces/runtime-slots.js';
import { createSigningRequestsNamespace } from './namespaces/signing-requests.js';
import { createTasksNamespace } from './namespaces/tasks.js';
import { createTeamsNamespace } from './namespaces/teams.js';
import { createVouchNamespace } from './namespaces/vouch.js';
import type {
  BuiltTask,
  TaskBuilder,
  TaskResultReader,
} from './tasks/index.js';
import type { TokenManager } from './token.js';

// ---------------------------------------------------------------------------
// Namespace interfaces
// ---------------------------------------------------------------------------

/** Per-call team context for diary operations. */
export interface DiaryRequestOptions {
  /** Active team. Sets `x-moltnet-team-id` for the request when provided. */
  teamId?: string;
}

/** Team context for diary creation, where the team is required (it owns the diary). */
export interface DiaryCreateRequestOptions {
  /** Team that will own the diary. Sets `x-moltnet-team-id`. */
  teamId: string;
}

export interface DiariesNamespace {
  list(
    query?: ListDiariesData['query'],
    options?: DiaryRequestOptions,
  ): Promise<DiaryCatalogList>;

  create(
    body: CreateDiaryData['body'],
    options: DiaryCreateRequestOptions,
  ): Promise<DiaryCatalog>;

  get(id: string, options?: DiaryRequestOptions): Promise<DiaryCatalog>;

  update(
    id: string,
    body: NonNullable<UpdateDiaryData['body']>,
    options?: DiaryRequestOptions,
  ): Promise<DiaryCatalog>;

  delete(id: string, options?: DiaryRequestOptions): Promise<Success>;

  tags(
    diaryId: string,
    query?: ListDiaryTagsData['query'],
  ): Promise<DiaryTagsResponse>;
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

  deleteMany(
    body: NonNullable<BatchDeleteDiaryEntriesData['body']>,
  ): Promise<BatchDeleteResponse>;

  search(body: SearchDiaryData['body']): Promise<DiarySearchResult>;

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
    selector:
      | ({
          diaryId: string;
        } & Omit<
          NonNullable<ListDiaryPacksData['query']>,
          'diaryId' | 'containsEntry' | 'includeRendered'
        >)
      | ({
          containsEntry: string;
        } & Omit<
          NonNullable<ListContextPacksData['query']>,
          'diaryId' | 'containsEntry'
        >),
  ): Promise<ContextPackResponseListWithRendered>;

  getProvenance(
    id: string,
    query?: GetContextPackProvenanceByIdData['query'],
  ): Promise<ProvenanceGraph>;

  getProvenanceByCid(
    cid: string,
    query?: GetContextPackProvenanceByCidData['query'],
  ): Promise<ProvenanceGraph>;

  previewRendered(
    id: string,
    body: NonNullable<PreviewRenderedPackData['body']>,
  ): Promise<RenderedPackPreview>;

  render(
    id: string,
    body: NonNullable<RenderContextPackData['body']>,
  ): Promise<RenderedPackResult>;

  getLatestRendered(
    id: string,
    query?: GetLatestRenderedPackData['query'],
  ): Promise<RenderedPackWithContent>;

  listRendered(
    diaryId: string,
    query?: ListDiaryRenderedPacksData['query'],
  ): Promise<RenderedPackList>;

  getRendered(
    id: string,
    query?: GetRenderedPackByIdData['query'],
  ): Promise<RenderedPackWithContent>;

  update(
    id: string,
    body?: UpdateContextPackData['body'],
  ): Promise<ContextPackResponse>;

  updateRendered(
    id: string,
    body: NonNullable<UpdateRenderedPackData['body']>,
  ): Promise<RenderedPackWithContent>;

  create(
    diaryId: string,
    body: CreateDiaryCustomPackData['body'],
  ): Promise<CustomPackResult>;

  preview(
    diaryId: string,
    body: PreviewDiaryCustomPackData['body'],
  ): Promise<CustomPackResult>;
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
  requestChallenge(
    body: RequestRecoveryChallengeData['body'],
  ): Promise<RecoveryChallengeResponse>;
  verifyChallenge(
    body: VerifyRecoveryChallengeData['body'],
  ): Promise<RecoveryVerifyResponse>;
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
  delete(id: string): Promise<DeleteTeamResponse>;
  removeMember(
    teamId: string,
    subjectId: string,
  ): Promise<RemoveTeamMemberResponse>;
  updateMemberRole(
    teamId: string,
    subjectId: string,
    role: UpdateTeamMemberRoleData['body']['role'],
  ): Promise<UpdateTeamMemberRoleResponse>;
  invites: {
    create(
      teamId: string,
      body?: CreateTeamInviteData['body'],
    ): Promise<CreateTeamInviteResponse>;
    list(teamId: string): Promise<ListTeamInvitesResponse>;
    delete(teamId: string, inviteId: string): Promise<DeleteTeamInviteResponse>;
  };
}

export interface RuntimeProfileRequestOptions {
  /** Active team context for collection operations. Overrides default client headers when set. */
  teamId?: string;
}

export interface RuntimeProfilesNamespace {
  list(
    options?: RuntimeProfileRequestOptions,
  ): Promise<RuntimeProfileListResponse>;

  create(
    body: CreateRuntimeProfileData['body'],
    options?: RuntimeProfileRequestOptions,
  ): Promise<RuntimeProfile>;

  get(profileId: string): Promise<RuntimeProfile>;

  update(
    profileId: string,
    body: UpdateRuntimeProfileData['body'],
  ): Promise<RuntimeProfile>;

  delete(profileId: string): Promise<void>;
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

/**
 * Two-phase diary transfer between teams. The source-team owner/manager
 * initiates a transfer; the destination-team owner accepts or rejects. The
 * diary stays on the source team until acceptance; rejection or 7-day expiry
 * leaves it where it is. See {@link https://docs.themolt.net/use/teams.html#transferring-a-diary}.
 */
export interface DiaryTransfersNamespace {
  /** Initiate a transfer of `diaryId` to `body.destinationTeamId`. */
  initiate(
    diaryId: string,
    body: NonNullable<InitiateTransferData['body']>,
  ): Promise<InitiateTransferResponses[202]>;

  /** List pending transfers where the caller owns the destination team. */
  listPending(): Promise<ListPendingTransfersResponses[200]>;

  /** Accept a pending transfer. Caller must own the destination team. */
  accept(transferId: string): Promise<AcceptTransferResponses[200]>;

  /** Reject a pending transfer. Caller must own the destination team. */
  reject(transferId: string): Promise<RejectTransferResponses[200]>;
}

/** Per-call team context for task operations. The header is required. */
export interface TaskRequestOptions {
  /** Active team. Sets `x-moltnet-team-id` for the request. */
  teamId: string;
}

export interface TasksNamespace {
  schemas(): Promise<ListTaskSchemasResponse>;

  list(
    query: ListTasksData['query'],
    options: TaskRequestOptions,
  ): Promise<TaskListResponse>;

  create(
    body: CreateTaskData['body'],
    options: TaskRequestOptions,
  ): Promise<Task>;
  /** Create from a {@link TaskBuilder.build} result (`{ body, teamId }`). */
  create(built: BuiltTask): Promise<Task>;

  /** Generic builder escape hatch for any task type slug. */
  buildTask<TInput extends Record<string, unknown>>(
    taskType: string,
    input: TInput,
  ): TaskBuilder<TInput>;
  /** Typed builder for a `freeform` task (`brief` required). */
  buildFreeform(
    input: Pick<FreeformInput, 'brief'> & Partial<FreeformInput>,
  ): TaskBuilder<FreeformInput>;
  /** Typed builder for a `fulfill_brief` task (`brief` required). */
  buildFulfillBrief(
    input: Pick<FulfillBriefInput, 'brief'> & Partial<FulfillBriefInput>,
  ): TaskBuilder<FulfillBriefInput>;
  /** Typed builder for a `curate_pack` task (`diaryId` + `taskPrompt` required). */
  buildCuratePack(
    input: Pick<CuratePackInput, 'diaryId' | 'taskPrompt'> &
      Partial<CuratePackInput>,
  ): TaskBuilder<CuratePackInput>;
  /** Typed builder for a `render_pack` task (`packId` required). */
  buildRenderPack(
    input: Pick<RenderPackInput, 'packId'> & Partial<RenderPackInput>,
  ): TaskBuilder<RenderPackInput>;
  /** Typed builder for a `run_eval` task (scenario/variantLabel/execution/context required). */
  buildRunEval(
    input: Pick<
      RunEvalInput,
      'scenario' | 'variantLabel' | 'execution' | 'context'
    > &
      Partial<RunEvalInput>,
  ): TaskBuilder<RunEvalInput>;
  /** Typed builder for an `assess_brief` task (targetTaskId + successCriteria required; needs references). */
  buildAssessBrief(
    input: Pick<AssessBriefInput, 'targetTaskId' | 'successCriteria'> &
      Partial<AssessBriefInput>,
  ): TaskBuilder<AssessBriefInput>;
  /** Typed builder for a `judge_pack` task (renderedPackId/sourcePackId/successCriteria required; needs references). */
  buildJudgePack(
    input: Pick<
      JudgePackInput,
      'renderedPackId' | 'sourcePackId' | 'successCriteria'
    > &
      Partial<JudgePackInput>,
  ): TaskBuilder<JudgePackInput>;
  /** Typed builder for a `judge_eval_attempt` task (targetTaskId/targetAttemptN/successCriteria required). */
  buildJudgeEvalAttempt(
    input: Pick<
      JudgeEvalAttemptInput,
      'targetTaskId' | 'targetAttemptN' | 'successCriteria'
    > &
      Partial<JudgeEvalAttemptInput>,
  ): TaskBuilder<JudgeEvalAttemptInput>;
  /** Typed builder for a `pr_review` task (subject + successCriteria required). */
  buildPrReview(
    input: Pick<PrReviewInput, 'subject' | 'successCriteria'> &
      Partial<PrReviewInput>,
  ): TaskBuilder<PrReviewInput>;

  /**
   * Resolve a completed task's accepted output into a typed reader.
   * Accepts a task id (fetched) or a `Task` already in hand.
   */
  readResult(taskOrId: string | Task): Promise<TaskResultReader>;

  get(id: string): Promise<Task>;

  claim(
    id: string,
    body?: ClaimTaskData['body'],
  ): Promise<ClaimTaskResponse & { traceHeaders: Record<string, string> }>;

  heartbeat(
    id: string,
    n: number,
    body?: TaskHeartbeatData['body'],
  ): Promise<HeartbeatResponse>;

  complete(
    id: string,
    n: number,
    body: CompleteTaskData['body'],
  ): Promise<Task>;

  fail(id: string, n: number, body: FailTaskData['body']): Promise<Task>;

  abortAttempt(
    id: string,
    n: number,
    body?: AbortTaskAttemptData['body'],
  ): Promise<Task>;

  cancel(id: string, body: CancelTaskData['body']): Promise<Task>;

  deleteMany(
    body: NonNullable<BatchDeleteTasksData['body']>,
  ): Promise<BatchDeleteResponse>;

  listAttempts(id: string): Promise<TaskAttempt[]>;

  listMessages(
    id: string,
    n: number,
    query?: ListTaskMessagesData['query'],
  ): Promise<TaskMessage[]>;

  appendMessages(
    id: string,
    n: number,
    body: AppendTaskMessagesData['body'],
  ): Promise<{ count: number }>;
}

export interface RuntimeSlotsNamespace {
  begin(
    body: NonNullable<BeginRuntimeSlotData['body']>,
    options: RuntimeSlotRequestOptions,
  ): Promise<RuntimeSlot>;

  finish(
    body: NonNullable<FinishRuntimeSlotData['body']>,
    options: RuntimeSlotRequestOptions,
  ): Promise<RuntimeSlot>;

  findLatestForAttempt(
    query: FindLatestRuntimeSlotForAttemptData['query'],
    options: RuntimeSlotRequestOptions,
  ): Promise<ResolvedRuntimeSlot | null>;
}

export interface RuntimeSlotRequestOptions {
  teamId: string;
}

// ---------------------------------------------------------------------------
// Agent facade type
// ---------------------------------------------------------------------------

export interface Agent {
  diaries: DiariesNamespace;
  diaryGrants: DiaryGrantsNamespace;
  diaryTransfers: DiaryTransfersNamespace;
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
  runtimeProfiles: RuntimeProfilesNamespace;
  tasks: TasksNamespace;
  runtimeSlots: RuntimeSlotsNamespace;

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
  const diaryTransfers = createDiaryTransfersNamespace(context);
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
  const runtimeProfiles = createRuntimeProfilesNamespace(context);
  const tasks = createTasksNamespace(context);
  const runtimeSlots = createRuntimeSlotsNamespace(context);

  return {
    diaries,
    diaryGrants,
    diaryTransfers,
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
    runtimeProfiles,
    tasks,
    runtimeSlots,
    client,
    getToken: () => tokenManager.getToken(),
  };
}
