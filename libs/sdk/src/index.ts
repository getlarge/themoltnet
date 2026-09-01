export type {
  Agent,
  AgentEnrollmentsNamespace,
  AgentKeyIssueRequestOptions,
  AgentKeysNamespace,
  AgentsNamespace,
  AuthNamespace,
  CryptoNamespace,
  DiariesNamespace,
  DiaryGrantsNamespace,
  EntriesNamespace,
  LegreffierNamespace,
  PacksNamespace,
  ProblemsNamespace,
  PublicNamespace,
  RecoveryNamespace,
  RuntimeProfileRequestOptions,
  RuntimeProfilesNamespace,
  RuntimeSessionDownloadStream,
  RuntimeSessionRequestOptions,
  RuntimeSessionsNamespace,
  RuntimeSessionUploadBody,
  RuntimeSlotsNamespace,
  SigningCredentialsNamespace,
  SigningRequestsNamespace,
  SigningVerificationMethod,
  TaskArtifactDownload,
  TaskArtifactsNamespace,
  TaskArtifactUploadBody,
  TaskCreateOptions,
  TaskGrantsNamespace,
  TaskRequestOptions,
  TasksNamespace,
  TeamsNamespace,
} from './agent.js';
export { createAgent } from './agent.js';
export { writeMcpConfig } from './config.js';
export {
  connect,
  type ConnectAgentKeyOptions,
  type ConnectOAuth2Options,
  type ConnectOptions,
} from './connect.js';
export {
  type CredentialResolutionCode,
  CredentialResolutionError,
  resetLegacyCredentialWarnings,
  resolveAgentKey,
  resolveEnvSecretReference,
  resolveIdentitySeed,
  resolveOAuth2ClientSecret,
  resolveThroughRegistry,
  warnLegacyCredentialFieldOnce,
} from './credential-resolver.js';
export {
  deriveMcpUrl,
  getConfigDir,
  getConfigPath,
  type GitHubConfig,
  type KeysConfig,
  type MoltNetConfig,
  type OAuth2Config,
  readConfig,
  type SecretReference,
  updateConfigSection,
  updateGitHubConfig,
  updateKeysConfig,
  updateOAuth2Config,
  writeConfig,
} from './credentials.js';
export {
  decryptFromAgent,
  decryptWithCredentials,
  deriveEncryptionKeys,
  encryptForAgent,
  type SealedEnvelope,
} from './encrypt.js';
export {
  AuthenticationError,
  MoltNetError,
  NetworkError,
  problemToError,
  RegistrationError,
  type ValidationError,
} from './errors.js';
export {
  createExecutorAttestor,
  type ExecutorAttestationFields,
  type ExecutorAttestor,
  type ExecutorClaimReference,
} from './executor-attestation.js';
export {
  connectHuman,
  type ConnectHumanOptions,
  type HumanClient,
} from './human.js';
export { info, type InfoOptions } from './info.js';
export { SignedEntryCreateError } from './namespaces/entries.js';
export type {
  RequiredTeamRequestOptions,
  TeamRequestOptions,
} from './namespaces/team-headers.js';
export type {
  BeginPreviewSignCredentialRegistration,
  CompletePreviewSignCredentialRegistration,
  CompletePreviewSignRequest,
  PreviewSignArkgSeedPublicKey,
  PreviewSignChallenge,
  PreviewSignChallengeOperation,
  PreviewSignChallengeValidation,
  PreviewSignChallengeValue,
  PreviewSignEcdhEsHkdf256PublicKey,
  PreviewSignEs256PublicKey,
  PreviewSignEsp256PublicKey,
  PreviewSignEvidence,
  PreviewSignEvidenceValue,
  PreviewSignPublicMaterial,
  PreviewSignReceipt,
  PreviewSignReceiptValue,
} from './preview-sign.js';
export {
  createPreviewSignReceipt,
  type DecodedPreviewSignChallenge,
  decodePreviewSignChallenge,
  PREVIEW_SIGN_ALGORITHM,
  PREVIEW_SIGN_CREDENTIAL_TYPE,
  PREVIEW_SIGN_VERIFICATION_METHOD,
  validatePreviewSignChallenge,
  type ValidatePreviewSignChallengeOptions,
} from './preview-sign.js';
export {
  type BootstrapCredentialType,
  buildMcpConfig,
  buildSelfRegistrationMessage,
  buildTeamRegistrationMessage,
  createIdempotencyKey,
  enroll,
  type EnrollOptions,
  type McpConfig,
  register,
  type RegisterOptions,
  type RegisterResult,
  type RegistrationCredentials,
} from './register.js';
export { createRemoteSigner, RemoteSignerError } from './remote-signer.js';
export { type ConfigIssue, repairConfig, type RepairResult } from './repair.js';
export { type RetryOptions } from './retry.js';
export {
  agentKeyKey,
  assertSecretReferenceBinding,
  assertSecretReferenceBoundTo,
  createDefaultSecretProviderRegistry,
  CREDENTIAL_ENV_KEYS,
  type CredentialBindingIds,
  type CredentialKind,
  ENVIRONMENT_SECRET_PROVIDER,
  EnvironmentSecretProvider,
  expectedSecretKey,
  identitySeedKey,
  MOLTNET_SECRET_SERVICE,
  oauth2SecretKey,
  OS_KEYRING_SECRET_PROVIDER,
  parseSecretReferenceString,
  READ_ONLY_CAPABILITIES,
  READ_WRITE_CAPABILITIES,
  SecretConflictError,
  SecretEnsureError,
  type SecretProbeResult,
  type SecretProvider,
  type SecretProviderCapabilities,
  SecretProviderReadOnlyError,
  SecretProviderRegistry,
  type SecretReferenceBinding,
} from './secrets.js';
export { sign, signBytes } from './sign.js';
export { exportSSHKey } from './ssh.js';
export {
  type AcceptedMeta,
  type ArtifactFilter,
  type ArtifactReferenceSource,
  buildAssessBrief,
  buildCuratePack,
  buildFreeform,
  buildFulfillBrief,
  buildJudgeEvalAttempt,
  buildJudgeEvalAttemptForRunEval,
  buildJudgePack,
  buildPrReview,
  buildRenderPack,
  buildRubricSuccessCriteria,
  type BuildRubricSuccessCriteriaOptions,
  buildRunEval,
  buildTask,
  type BuiltTask,
  createResultReader,
  type CreateTaskBody,
  formatValidationErrors,
  type FreeformArtifactLike,
  type JudgeEvalAttemptTarget,
  normalizeRubricCriteria,
  PRODUCER_TASK_TYPES,
  type ReferenceRole,
  type ReferenceSource,
  type RubricCriterionInput,
  TaskBuilder,
  TaskBuildError,
  TaskResultError,
  TaskResultReader,
} from './tasks/index.js';
export { TokenManager, type TokenManagerOptions } from './token.js';
export type {
  AgentKey,
  AgentKeyList,
  AgentKeyRevocationReason,
  AgentKeyStatus,
  AgentKeyWithSecret,
  CreateAgentKeyBody,
  RevokeAgentKeyBody,
  Whoami,
} from '@moltnet/api-client';
export {
  type AgentIdentity,
  type AgentSigningCapability,
  computeCanonicalHash,
  computeContentCid,
} from '@moltnet/crypto-service';
export {
  CONTEXT_BINDINGS,
  CONTEXT_REF_MAX_CONTENT_LENGTH,
  type ContextBinding,
  type ContextRef,
} from '@moltnet/runtime-profiles';

import { connect } from './connect.js';
import { connectHuman } from './human.js';
import { info } from './info.js';
import { enroll, register } from './register.js';
import { sign } from './sign.js';

export const MoltNet = {
  register,
  enroll,
  info,
  sign,
  connect,
  connectHuman,
} as const;
