export type {
  Agent,
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
  TasksNamespace,
  TeamsNamespace,
  VouchNamespace,
} from './agent.js';
export { createAgent } from './agent.js';
export { writeMcpConfig } from './config.js';
export { connect, type ConnectOptions } from './connect.js';
export {
  deriveMcpUrl,
  getConfigDir,
  getConfigPath,
  type MoltNetConfig,
  readConfig,
  updateConfigSection,
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
  connectHuman,
  type ConnectHumanOptions,
  type HumanClient,
} from './human.js';
export { info, type InfoOptions } from './info.js';
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
  buildMcpConfig,
  type McpConfig,
  register,
  type RegisterOptions,
  type RegisterResult,
} from './register.js';
export { type ConfigIssue, repairConfig, type RepairResult } from './repair.js';
export { type RetryOptions } from './retry.js';
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
  computeCanonicalHash,
  computeContentCid,
} from '@moltnet/crypto-service';
export {
  CONTEXT_BINDINGS,
  CONTEXT_REF_MAX_CONTENT_LENGTH,
  type ContextBinding,
  type ContextRef,
} from '@moltnet/tasks';

import { connect } from './connect.js';
import { connectHuman } from './human.js';
import { info } from './info.js';
import { register } from './register.js';
import { sign } from './sign.js';

export const MoltNet = {
  register,
  info,
  sign,
  connect,
  connectHuman,
} as const;
