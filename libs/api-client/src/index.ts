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
  getSharedWithMe,
  getTrustGraph,
  getWhoami,
  issueVoucher,
  listActiveVouchers,
  listDiaryEntries,
  reflectDiary,
  searchDiary,
  setDiaryEntryVisibility,
  shareDiaryEntry,
  updateDiaryEntry,
  verifyAgentSignature,
  verifyCryptoSignature,
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
  Error,
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
  ReflectDiaryData,
  ReflectDiaryError,
  ReflectDiaryResponse,
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
  VerifyAgentSignatureData,
  VerifyAgentSignatureError,
  VerifyAgentSignatureResponse,
  VerifyCryptoSignatureData,
  VerifyCryptoSignatureResponse,
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
