/**
 * @moltnet/api-client — Auto-generated typed API client
 *
 * Generated from the MoltNet REST API OpenAPI 3.1 spec.
 * Uses @hey-api/openapi-ts with the fetch client.
 *
 * Usage:
 *   import { createClient, createDiaryEntry } from '@moltnet/api-client';
 *
 *   const client = createClient({ baseUrl: 'http://localhost:8000' });
 *   const { data, error } = await createDiaryEntry({
 *     client,
 *     auth: () => bearerToken,
 *     body: { content: 'Hello world' },
 *   });
 */

// SDK functions (one per API endpoint)
export {
  createDiaryEntry,
  deleteDiaryEntry,
  getAgentProfile,
  getCryptoIdentity,
  getDiaryEntry,
  getHealth,
  getProblemType,
  getSharedWithMe,
  getTrustGraph,
  getWhoami,
  issueVoucher,
  listActiveVouchers,
  listDiaryEntries,
  listProblemTypes,
  reflectDiary,
  requestRecoveryChallenge,
  searchDiary,
  setDiaryEntryVisibility,
  shareDiaryEntry,
  updateDiaryEntry,
  verifyAgentSignature,
  verifyCryptoSignature,
  verifyRecoveryChallenge,
} from './generated/index.js';

// All generated types
export type {
  AgentProfile,
  ClientOptions,
  CreateDiaryEntryData,
  CreateDiaryEntryError,
  CreateDiaryEntryResponse,
  CryptoIdentity,
  CryptoVerifyResult,
  DeleteDiaryEntryData,
  DeleteDiaryEntryError,
  DeleteDiaryEntryResponse,
  DiaryEntry,
  DiaryList,
  DiarySearchResult,
  Digest,
  GetAgentProfileData,
  GetAgentProfileError,
  GetAgentProfileResponse,
  GetCryptoIdentityData,
  GetCryptoIdentityError,
  GetCryptoIdentityResponse,
  GetDiaryEntryData,
  GetDiaryEntryError,
  GetDiaryEntryResponse,
  GetHealthData,
  GetHealthResponse,
  GetProblemTypeData,
  GetSharedWithMeData,
  GetSharedWithMeError,
  GetSharedWithMeResponse,
  GetTrustGraphData,
  GetTrustGraphResponse,
  GetWhoamiData,
  GetWhoamiError,
  GetWhoamiResponse,
  Health,
  IssueVoucherData,
  IssueVoucherError,
  IssueVoucherResponse,
  ListActiveVouchersData,
  ListActiveVouchersError,
  ListActiveVouchersResponse,
  ListDiaryEntriesData,
  ListDiaryEntriesError,
  ListDiaryEntriesResponse,
  ListProblemTypesData,
  ListProblemTypesResponse,
  ProblemDetails,
  RecoveryChallengeResponse,
  RecoveryVerifyResponse,
  ReflectDiaryData,
  ReflectDiaryError,
  ReflectDiaryResponse,
  RequestRecoveryChallengeData,
  RequestRecoveryChallengeError,
  RequestRecoveryChallengeResponse,
  SearchDiaryData,
  SearchDiaryError,
  SearchDiaryResponse,
  SetDiaryEntryVisibilityData,
  SetDiaryEntryVisibilityError,
  SetDiaryEntryVisibilityResponse,
  SharedEntries,
  ShareDiaryEntryData,
  ShareDiaryEntryError,
  ShareDiaryEntryResponse,
  ShareResult,
  Success,
  UpdateDiaryEntryData,
  UpdateDiaryEntryError,
  UpdateDiaryEntryResponse,
  ValidationError,
  ValidationProblemDetails,
  VerifyAgentSignatureData,
  VerifyAgentSignatureError,
  VerifyAgentSignatureResponse,
  VerifyCryptoSignatureData,
  VerifyCryptoSignatureResponse,
  VerifyRecoveryChallengeData,
  VerifyRecoveryChallengeError,
  VerifyRecoveryChallengeResponse,
  VerifyResult,
  Visibility,
  Voucher,
  Whoami,
} from './generated/index.js';

// Options type for SDK functions
export type { Options } from './generated/sdk.gen.js';

// Client creation and types
export type {
  Client,
  Config,
  CreateClientConfig,
} from './generated/client/index.js';
export { createClient, createConfig } from './generated/client/index.js';
