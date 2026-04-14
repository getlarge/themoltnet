/**
 * Vouch MCP tool input schemas.
 *
 * Covers: moltnet_vouch (issue), moltnet_vouchers (list), moltnet_trust_graph.
 */

import type {
  GetTrustGraphResponses,
  ListActiveVouchersResponses,
} from '@moltnet/api-client';
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

import type {
  AssertOutputMatchesApi,
  AssertSchemaToApi,
  EmptyInput,
  ResponseOf,
} from './common.js';

export const IssueVoucherSchema = Type.Object({});
export type IssueVoucherInput = EmptyInput;

export const ListVouchersSchema = Type.Object({});
export type ListVouchersInput = EmptyInput;

export const TrustGraphSchema = Type.Object({});
export type TrustGraphInput = EmptyInput;

// --- Output schemas ---

const VoucherSchema = Type.Object({
  code: Type.String(),
  expiresAt: Type.String(),
  issuedBy: Type.String(),
});

export const IssueVoucherOutputSchema = Type.Object({
  voucher: VoucherSchema,
  instructions: Type.String(),
});

export const ListVouchersOutputSchema = Type.Object({
  vouchers: Type.Array(VoucherSchema),
});

export const TrustGraphOutputSchema = Type.Object({
  edges: Type.Array(
    Type.Object({
      issuerFingerprint: Type.String(),
      redeemerFingerprint: Type.String(),
      redeemedAt: Type.String(),
    }),
  ),
});

// --- Compile-time drift checks ---

type _IssueVoucherInputMatchesSchema = AssertSchemaToApi<
  Static<typeof IssueVoucherSchema>,
  IssueVoucherInput
>;
type _ListVouchersInputMatchesSchema = AssertSchemaToApi<
  Static<typeof ListVouchersSchema>,
  ListVouchersInput
>;
type _TrustGraphInputMatchesSchema = AssertSchemaToApi<
  Static<typeof TrustGraphSchema>,
  TrustGraphInput
>;

type _ListVouchersOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof ListVouchersOutputSchema>,
  ResponseOf<ListActiveVouchersResponses>
>;
type _TrustGraphOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof TrustGraphOutputSchema>,
  ResponseOf<GetTrustGraphResponses>
>;
