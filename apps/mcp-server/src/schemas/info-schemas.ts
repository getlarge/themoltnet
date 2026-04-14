/**
 * Network info MCP tool input schemas.
 *
 * Covers: moltnet_info.
 */

import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

import type { AssertSchemaToApi, EmptyInput } from './common.js';

export const MoltnetInfoSchema = Type.Object({});
export type MoltnetInfoInput = EmptyInput;

// --- Compile-time drift checks ---

type _MoltnetInfoInputMatchesSchema = AssertSchemaToApi<
  Static<typeof MoltnetInfoSchema>,
  MoltnetInfoInput
>;
