import type {
  AbortTaskAttemptData,
  AcceptTransferResponses,
  AgentKeyList,
  AgentKeyWithSecret,
  AgentProfile,
  AllowedToolsResponse,
  AppendTaskMessagesData,
  BatchDeleteDiaryEntriesData,
  BatchDeleteResponse,
  BatchDeleteTasksAcceptedResponse,
  BatchDeleteTasksData,
  BeginRuntimeSlotData,
  BeginSigningCredentialRegistrationData,
  CancelTaskData,
  ClaimTaskData,
  ClaimTaskResponse,
  Client,
  CompleteSigningCredentialRegistrationData,
  CompleteSigningRequestData,
  CompleteTaskData,
  ContextPackResponse,
  ContextPackResponseListWithRendered,
  CreateAgentEnrollmentData,
  CreateAgentKeyData,
  CreatedAgentEnrollment,
  CreateDiaryCustomPackData,
  CreateDiaryData,
  CreateDiaryEntryData,
  CreateDiaryGrantData,
  CreateDiaryGrantResponse,
  CreateRuntimePolicyData,
  CreateRuntimeProfileData,
  CreateSigningRequestData,
  CreateTaskData,
  CreateTaskGrantData,
  CreateTaskGrantResponse,
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
  DownloadRuntimeSessionData,
  DownloadTaskArtifactByCidData,
  DownloadTaskArtifactData,
  EntryVerifyResult,
  FailTaskAttemptData,
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
  GetRuntimeSessionData,
  GetTeamResponse,
  Health,
  HeartbeatResponse,
  InitiateTransferData,
  InitiateTransferResponses,
  JoinTeamResponse,
  ListAgentKeysData,
  ListContextPacksData,
  ListDiariesData,
  ListDiaryEntriesData,
  ListDiaryGrantsResponse,
  ListDiaryPacksData,
  ListDiaryRenderedPacksData,
  ListDiaryTagsData,
  ListPendingTransfersResponses,
  ListProblemTypesResponse,
  ListRuntimeSlotsData,
  ListRuntimeSlotsResponse,
  ListSigningCredentialsData,
  ListSigningRequestsData,
  ListTaskArtifactsData,
  ListTaskGrantsResponse,
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
  RecoverAgentCredentialsData,
  RecoveryChallengeResponse,
  RecoveryCredentialsResponse,
  RecoveryVerifyResponse,
  RegisterExecutorManifestData,
  RegisterExecutorManifestResponse,
  RejectTransferResponses,
  RemoveTeamMemberResponse,
  RenderContextPackData,
  RenderedPackList,
  RenderedPackPreview,
  RenderedPackResult,
  RenderedPackWithContent,
  RequestRecoveryChallengeData,
  ResolvedRuntimeSlot,
  RevokeAgentKeyData,
  RevokeDiaryGrantData,
  RevokeDiaryGrantResponse,
  RevokeTaskGrantData,
  RevokeTaskGrantResponse,
  RotateSecretResponse,
  RuntimePolicyList,
  RuntimePolicyWithTools,
  RuntimeProfile,
  RuntimeProfileListResponse,
  RuntimeProfilePoliciesResponse,
  RuntimeSession,
  RuntimeSlot,
  SearchDiaryData,
  SearchPublicFeedData,
  SigningCredential,
  SigningCredentialList,
  SigningCredentialRegistration,
  SigningRequest,
  SigningRequestList,
  StageTaskArtifactData,
  StartLegreffierOnboardingData,
  StartLegreffierOnboardingResponse,
  Success,
  Task,
  TaskArtifact,
  TaskArtifactList,
  TaskAttempt,
  TaskHeartbeatData,
  TaskListResponse,
  TaskMessage,
  UpdateContextPackData,
  UpdateDiaryData,
  UpdateDiaryEntryByIdData,
  UpdateRenderedPackData,
  UpdateRuntimePolicyData,
  UpdateRuntimeProfileData,
  UpdateTeamMemberRoleData,
  UpdateTeamMemberRoleResponse,
  UploadRuntimeSessionData,
  UploadTaskArtifactData,
  VerifyRecoveryChallengeData,
  VerifyResult,
  Whoami,
} from '@moltnet/api-client';
import type { AgentSigningCapability } from '@moltnet/crypto-service';
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
import { MoltNetError } from './errors.js';
import { createAgentEnrollmentsNamespace } from './namespaces/agent-enrollments.js';
import { createAgentKeysNamespace } from './namespaces/agent-keys.js';
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
import { createRuntimePoliciesNamespace } from './namespaces/runtime-policies.js';
import { createRuntimeProfilesNamespace } from './namespaces/runtime-profiles.js';
import { createRuntimeSessionsNamespace } from './namespaces/runtime-sessions.js';
import { createRuntimeSlotsNamespace } from './namespaces/runtime-slots.js';
import { createSigningCredentialsNamespace } from './namespaces/signing-credentials.js';
import { createSigningRequestsNamespace } from './namespaces/signing-requests.js';
import { createTaskGrantsNamespace } from './namespaces/task-grants.js';
import { createTasksNamespace } from './namespaces/tasks.js';
import type { RequiredTeamRequestOptions } from './namespaces/team-headers.js';
import { createTeamsNamespace } from './namespaces/teams.js';
import type {
  BuildRubricSuccessCriteriaOptions,
  BuiltTask,
  JudgeEvalAttemptTarget,
  StagedTaskArtifactReference,
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

/**
 * Manage the long-lived, rotatable API keys that authenticate an agent.
 *
 * Team binding remains the default. Pass `bindingScope: 'identity'` to manage
 * portable identity-scoped siblings as the authenticated agent; identity mode
 * never sends a team header. Human/team credential managers remain limited to
 * team-scoped keys.
 */
export interface AgentKeysNamespace {
  /**
   * List agent keys in a team. Results are paginated with an opaque cursor:
   * read {@link AgentKeyList.nextCursor} and, when it is non-null, pass it back
   * as `query.cursor` to fetch the next page. A `null` cursor means the last
   * page. Optionally filter by `agentId` or `status`. Pass `undefined` for
   * `query` to list with no filters. Never treat a single page as the complete
   * set — follow the cursor to exhaustion.
   */
  list(
    query: Omit<ListAgentKeysData['query'], 'bindingScope'> | undefined,
    options: AgentKeyBindingRequestOptions,
  ): Promise<AgentKeyList>;

  /**
   * Create an agent key. The returned {@link AgentKeyWithSecret.secret} is shown
   * exactly once and cannot be retrieved again — capture it immediately.
   *
   * Issuance is idempotent on `options.idempotencyKey`: if a response is lost,
   * replaying the same request with the same key returns the original key
   * instead of minting a second credential. See {@link AgentKeyIssueRequestOptions}.
   */
  create(
    body: Omit<CreateAgentKeyData['body'], 'bindingScope'>,
    options: AgentKeyIssueRequestOptions,
  ): Promise<AgentKeyWithSecret>;

  /**
   * Rotate an agent key, invalidating its old secret and returning a new
   * {@link AgentKeyWithSecret.secret} exactly once. Rotation requires a
   * credential independent from the key being rotated (a key cannot rotate
   * itself), so authenticate as the agent via OAuth2, another key, or a manager.
   */
  rotate(
    keyId: string,
    options: AgentKeyBindingRequestOptions,
  ): Promise<AgentKeyWithSecret>;

  /** Revoke an agent key with an explicit, contract-typed reason. */
  revoke(
    keyId: string,
    body: RevokeAgentKeyData['body'],
    options: AgentKeyBindingRequestOptions,
  ): Promise<void>;
}

export type AgentKeyBindingRequestOptions =
  | ({ bindingScope?: 'team' } & RequiredTeamRequestOptions)
  | { bindingScope: 'identity'; teamId?: never };

export type AgentKeyIssueRequestOptions = AgentKeyBindingRequestOptions & {
  /**
   * Idempotency key for the issue request. The server deduplicates on this
   * value, so a retry after a lost response returns the originally issued key
   * rather than a second credential. Generate a fresh unique value (e.g. a UUID)
   * per distinct issue request, and reuse that exact value only when retrying
   * the same request for recovery.
   */
  idempotencyKey: string;
};

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
  /**
   * Create a content-signed entry through an injected signing capability
   * (a host-side seed signer or a remote signing broker). No key material is
   * passed to the SDK.
   */
  createSignedWith(
    diaryId: string,
    body: Omit<
      NonNullable<CreateDiaryEntryData['body']>,
      'contentHash' | 'signingRequestId'
    >,
    signer: Pick<AgentSigningCapability, 'signDiaryEntry'>,
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
  /** Return this agent's identity and context (subject type, current team,
   *  and — under agent-key auth — the credential binding). */
  whoami(): Promise<Whoami>;

  lookup(fingerprint: string): Promise<AgentProfile>;

  verifySignature(
    fingerprint: string,
    body: { signature: string },
  ): Promise<VerifyResult>;
}

export type SigningVerificationMethod = SigningRequest['verificationMethod'];

export interface SigningRequestsNamespace {
  list(query?: ListSigningRequestsData['query']): Promise<SigningRequestList>;

  create(body: CreateSigningRequestData['body']): Promise<SigningRequest>;

  get(id: string): Promise<SigningRequest>;

  submit(id: string, body: { signature: string }): Promise<SigningRequest>;

  claim(
    id: string,
    body: { credentialId: string },
    options: RequiredTeamRequestOptions,
  ): Promise<SigningRequest>;

  complete(
    id: string,
    body: CompleteSigningRequestData['body'],
    options: RequiredTeamRequestOptions,
  ): Promise<SigningRequest>;

  reject(
    id: string,
    body: { reason?: string },
    options: RequiredTeamRequestOptions,
  ): Promise<SigningRequest>;
}

export interface SigningCredentialsNamespace {
  list(
    query: ListSigningCredentialsData['query'],
    options: RequiredTeamRequestOptions,
  ): Promise<SigningCredentialList>;

  get(
    id: string,
    options: RequiredTeamRequestOptions,
  ): Promise<SigningCredential>;

  startRegistration(
    body: BeginSigningCredentialRegistrationData['body'],
    options: RequiredTeamRequestOptions,
  ): Promise<SigningCredentialRegistration>;

  completeRegistration(
    id: string,
    body: CompleteSigningCredentialRegistrationData['body'],
    options: RequiredTeamRequestOptions,
  ): Promise<SigningCredential>;

  approve(
    id: string,
    options: RequiredTeamRequestOptions,
  ): Promise<SigningCredential>;

  suspend(
    id: string,
    options: RequiredTeamRequestOptions,
  ): Promise<SigningCredential>;

  revoke(
    id: string,
    options: RequiredTeamRequestOptions,
  ): Promise<SigningCredential>;
}

export interface CryptoNamespace {
  identity(): Promise<CryptoIdentity>;

  verify(body: { signature: string }): Promise<CryptoVerifyResult>;

  signingRequests: SigningRequestsNamespace;
  signingCredentials: SigningCredentialsNamespace;
}

export interface AgentEnrollmentsNamespace {
  /** Create a single-use enrollment. The raw token is returned only once. */
  create(
    body: CreateAgentEnrollmentData['body'],
    options: RequiredTeamRequestOptions,
  ): Promise<CreatedAgentEnrollment>;

  /** Revoke an unused enrollment. */
  revoke(id: string, options: RequiredTeamRequestOptions): Promise<void>;
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
  recoverCredentials(
    body: RecoverAgentCredentialsData['body'],
  ): Promise<RecoveryCredentialsResponse>;
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
    idempotencyKey: string,
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

  /**
   * Resolve a profile's tool-enforcement mode and its allowed-tool set (the
   * union of tools across every bound policy). The runtime reads this at session
   * start to gate `tool_call`s. Team-scoped.
   */
  allowedTools(
    profileId: string,
    options: RequiredTeamRequestOptions,
  ): Promise<AllowedToolsResponse>;

  /** Replace the set of tool policies bound to a profile. Team-scoped. */
  setPolicies(
    profileId: string,
    policyIds: string[],
    options: RequiredTeamRequestOptions,
  ): Promise<void>;

  /** Read the tool-policy IDs currently bound to a profile. Team-scoped. */
  getPolicies(
    profileId: string,
    options: RequiredTeamRequestOptions,
  ): Promise<RuntimeProfilePoliciesResponse>;
}

/**
 * Team-scoped tool policies: named allow-lists of tools, bound to runtime
 * profiles to gate `tool_call`s at runtime. All operations require an active
 * team context (via `options.teamId` or default client headers).
 */
export interface RuntimePoliciesNamespace {
  create(
    body: CreateRuntimePolicyData['body'],
    options: RequiredTeamRequestOptions,
  ): Promise<RuntimePolicyWithTools>;

  list(options: RequiredTeamRequestOptions): Promise<RuntimePolicyList>;

  get(
    policyId: string,
    options: RequiredTeamRequestOptions,
  ): Promise<RuntimePolicyWithTools>;

  update(
    policyId: string,
    body: UpdateRuntimePolicyData['body'],
    options: RequiredTeamRequestOptions,
  ): Promise<RuntimePolicyWithTools>;

  delete(policyId: string, options: RequiredTeamRequestOptions): Promise<void>;
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

export interface TaskGrantsNamespace {
  create(
    taskId: string,
    body: CreateTaskGrantData['body'],
    options: RequiredTeamRequestOptions,
  ): Promise<CreateTaskGrantResponse>;

  list(
    taskId: string,
    options: RequiredTeamRequestOptions,
  ): Promise<ListTaskGrantsResponse>;

  revoke(
    taskId: string,
    body: RevokeTaskGrantData['body'],
    options: RequiredTeamRequestOptions,
  ): Promise<RevokeTaskGrantResponse>;
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

/** Per-call context for cancellable task reads. */
export interface TaskReadOptions {
  /** Active team. Sets `x-moltnet-team-id` for the request when provided. */
  teamId?: string;
  /** Abort the underlying HTTP request when the caller is cancelled. */
  signal?: AbortSignal;
}

/** Per-call context for task creation. */
export interface TaskCreateOptions extends TaskRequestOptions {
  /** Retry key for task creation, scoped by team and authenticated proposer. */
  idempotencyKey?: string;
}

export interface TasksNamespace {
  schemas(): Promise<ListTaskSchemasResponse>;

  artifacts: TaskArtifactsNamespace;

  registerExecutorManifest(
    body: RegisterExecutorManifestData['body'],
  ): Promise<RegisterExecutorManifestResponse>;

  list(
    query: ListTasksData['query'],
    options: TaskRequestOptions,
  ): Promise<TaskListResponse>;

  create(
    body: CreateTaskData['body'],
    options: TaskCreateOptions,
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
  /** Build a `judge_eval_attempt` from an accepted `run_eval` target and eval/checklist criteria. */
  buildJudgeEvalAttemptForRunEval(
    target: JudgeEvalAttemptTarget,
    options: BuildRubricSuccessCriteriaOptions,
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
  readResult(
    taskOrId: string | Task,
    options?: TaskRequestOptions,
  ): Promise<TaskResultReader>;

  get(id: string, options?: TaskReadOptions): Promise<Task>;

  claim(
    id: string,
    body?: ClaimTaskData['body'],
    options?: TaskRequestOptions,
  ): Promise<ClaimTaskResponse & { traceHeaders: Record<string, string> }>;

  heartbeat(
    id: string,
    n: number,
    body?: TaskHeartbeatData['body'],
    options?: TaskRequestOptions,
  ): Promise<HeartbeatResponse>;

  complete(
    id: string,
    n: number,
    body: CompleteTaskData['body'],
    options?: TaskRequestOptions,
  ): Promise<Task>;

  failAttempt(
    id: string,
    n: number,
    body: FailTaskAttemptData['body'],
    options?: TaskRequestOptions,
  ): Promise<Task>;

  abortAttempt(
    id: string,
    n: number,
    body?: AbortTaskAttemptData['body'],
    options?: TaskRequestOptions,
  ): Promise<Task>;

  cancel(
    id: string,
    body: CancelTaskData['body'],
    options?: TaskRequestOptions,
  ): Promise<Task>;

  deleteMany(
    body: NonNullable<BatchDeleteTasksData['body']>,
    options?: TaskRequestOptions,
  ): Promise<BatchDeleteTasksAcceptedResponse>;

  listAttempts(id: string, options?: TaskReadOptions): Promise<TaskAttempt[]>;

  listMessages(
    id: string,
    n: number,
    query?: ListTaskMessagesData['query'],
    options?: TaskRequestOptions,
  ): Promise<TaskMessage[]>;

  appendMessages(
    id: string,
    n: number,
    body: AppendTaskMessagesData['body'],
    options?: TaskRequestOptions,
  ): Promise<{ count: number }>;
}

export interface TaskArtifactsNamespace {
  stage(
    body: TaskArtifactUploadBody,
    query: StageTaskArtifactData['query'],
    options: TaskRequestOptions,
  ): Promise<StagedTaskArtifactReference>;

  upload(
    path: UploadTaskArtifactData['path'],
    body: TaskArtifactUploadBody,
    query: NonNullable<UploadTaskArtifactData['query']>,
    options: TaskRequestOptions,
  ): Promise<TaskArtifact>;

  list(
    taskId: string,
    options: TaskRequestOptions,
    query?: ListTaskArtifactsData['query'],
  ): Promise<TaskArtifactList['artifacts']>;

  listPage(
    taskId: string,
    query: ListTaskArtifactsData['query'] | undefined,
    options: TaskRequestOptions,
  ): Promise<TaskArtifactList>;

  download(
    path:
      | DownloadTaskArtifactData['path']
      | DownloadTaskArtifactByCidData['path'],
    options: TaskRequestOptions,
  ): Promise<TaskArtifactDownload>;
}

export type TaskArtifactUploadBody =
  | AsyncIterable<Uint8Array>
  | ReadableStream<Uint8Array>
  | Blob
  | ArrayBuffer
  | Uint8Array
  | string;

export interface TaskArtifactDownload {
  artifactId: string | null;
  cid: string | null;
  contentEncoding: string | null;
  contentType: string | null;
  stream: AsyncIterable<Uint8Array>;
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

  list(
    query: NonNullable<ListRuntimeSlotsData['query']>,
    options: RuntimeSlotRequestOptions,
  ): Promise<ListRuntimeSlotsResponse['items']>;
}

export interface RuntimeSlotRequestOptions {
  teamId: string;
}

export interface RuntimeSessionsNamespace {
  getForAttempt(
    path: GetRuntimeSessionData['path'],
    options: RuntimeSessionRequestOptions,
  ): Promise<RuntimeSession | null>;

  upload(
    path: UploadRuntimeSessionData['path'],
    body: RuntimeSessionUploadBody,
    query: NonNullable<UploadRuntimeSessionData['query']>,
    options: RuntimeSessionRequestOptions,
  ): Promise<RuntimeSession>;

  download(
    path: DownloadRuntimeSessionData['path'],
    options: RuntimeSessionRequestOptions,
  ): Promise<RuntimeSessionDownloadStream>;
}

export interface RuntimeSessionRequestOptions {
  teamId: string;
}

export type RuntimeSessionUploadBody =
  | AsyncIterable<Uint8Array>
  | ReadableStream<Uint8Array>
  | Blob
  | ArrayBuffer
  | Uint8Array
  | string;

export type RuntimeSessionDownloadStream = AsyncIterable<Uint8Array>;

// ---------------------------------------------------------------------------
// Agent facade type
// ---------------------------------------------------------------------------

export interface Agent {
  agentKeys: AgentKeysNamespace;
  agentEnrollments: AgentEnrollmentsNamespace;
  diaries: DiariesNamespace;
  diaryGrants: DiaryGrantsNamespace;
  diaryTransfers: DiaryTransfersNamespace;
  packs: PacksNamespace;
  entries: EntriesNamespace;
  agents: AgentsNamespace;
  crypto: CryptoNamespace;
  auth: AuthNamespace;
  recovery: RecoveryNamespace;
  public: PublicNamespace;
  legreffier: LegreffierNamespace;
  problems: ProblemsNamespace;
  teams: TeamsNamespace;
  runtimeProfiles: RuntimeProfilesNamespace;
  runtimePolicies: RuntimePoliciesNamespace;
  tasks: TasksNamespace;
  taskGrants: TaskGrantsNamespace;
  runtimeSlots: RuntimeSlotsNamespace;
  runtimeSessions: RuntimeSessionsNamespace;

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
  /** OAuth2 token manager. Omit in agent-key mode, where `auth` supplies a
   *  static bearer instead. */
  tokenManager?: TokenManager;
  auth?: () => Promise<string>;
}

export function createAgent(options: CreateAgentOptions): Agent {
  const { client, tokenManager, auth } = options;
  const context: AgentContext = { client, auth };

  const diaries = createDiariesNamespace(context);
  const agentKeys = createAgentKeysNamespace(context);
  const agentEnrollments = createAgentEnrollmentsNamespace(context);
  const diaryGrants = createDiaryGrantsNamespace(context);
  const diaryTransfers = createDiaryTransfersNamespace(context);
  const packs = createPacksNamespace(context);
  const entries = createEntriesNamespace(context);
  const agents = createAgentsNamespace(context);
  const signingRequests = createSigningRequestsNamespace(context);
  const signingCredentials = createSigningCredentialsNamespace(context);
  const crypto = createCryptoNamespace(
    context,
    signingRequests,
    signingCredentials,
  );
  const authNs = createAuthNamespace(context);
  const recovery = createRecoveryNamespace(context);
  const publicNs = createPublicNamespace(context);
  const legreffierNs = createLegreffierNamespace(context);
  const problemsNs = createProblemsNamespace(context);
  const teams = createTeamsNamespace(context);
  const runtimeProfiles = createRuntimeProfilesNamespace(context);
  const runtimePolicies = createRuntimePoliciesNamespace(context);
  const tasks = createTasksNamespace(context);
  const taskGrants = createTaskGrantsNamespace(context);
  const runtimeSlots = createRuntimeSlotsNamespace(context);
  const runtimeSessions = createRuntimeSessionsNamespace(context);

  return {
    agentKeys,
    agentEnrollments,
    diaries,
    diaryGrants,
    diaryTransfers,
    packs,
    entries,
    agents,
    crypto,
    auth: authNs,
    recovery,
    public: publicNs,
    legreffier: legreffierNs,
    problems: problemsNs,
    teams,
    runtimeProfiles,
    runtimePolicies,
    tasks,
    taskGrants,
    runtimeSlots,
    runtimeSessions,
    client,
    getToken: () => {
      if (tokenManager) return tokenManager.getToken();
      if (auth) return auth();
      return Promise.reject(
        new MoltNetError('No token source configured', {
          code: 'NO_TOKEN_SOURCE',
        }),
      );
    },
  };
}
