/**
 * Vouch MCP tool input schemas.
 *
 * Covers: moltnet_vouch (issue), moltnet_vouchers (list), moltnet_trust_graph.
 */

import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

import type { AssertSchemaToApi, EmptyInput } from './common.js';

export const IssueVoucherSchema = Type.Object({});
export type IssueVoucherInput = EmptyInput;

export const ListVouchersSchema = Type.Object({});
export type ListVouchersInput = EmptyInput;

export const TrustGraphSchema = Type.Object({});
export type TrustGraphInput = EmptyInput;

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
