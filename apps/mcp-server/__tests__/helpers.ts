/**
 * Test helpers — mocks and fixtures for MCP server tests
 *
 * Provides helpers for testing handlers that use the generated
 * @moltnet/api-client SDK functions.
 */

import type { Client } from '@moltnet/api-client';
import { vi } from 'vitest';

import type { McpDeps } from '../src/types.js';

const TOKEN = 'test-bearer-token';
export const ENTRY_ID = '770e8400-e29b-41d4-a716-446655440002';

/**
 * Create McpDeps with a mock client.
 * Pass `null` for token to simulate unauthenticated state.
 *
 * The client is a stub — actual HTTP calls are mocked at the SDK function
 * level via vi.mock('@moltnet/api-client') in each test file.
 */
export function createMockDeps(token: string | null = TOKEN): McpDeps {
  return {
    client: {} as Client,
    getAccessToken: () => token,
    signMessage: vi.fn().mockResolvedValue('ed25519:sig123'),
  };
}

/** Build a successful SDK response (data present, no error) */
export function sdkOk<T>(data: T, status = 200) {
  return {
    data,
    error: undefined,
    request: {} as Request,
    response: { status } as Response,
  };
}

/** Build an error SDK response (no data, error present) */
export function sdkErr(
  error: { error: string; message: string; statusCode: number },
  status?: number,
) {
  return {
    data: undefined,
    error,
    request: {} as Request,
    response: { status: status ?? error.statusCode } as Response,
  };
}

/** Helper to extract text content from a CallToolResult */
export function getTextContent(result: {
  content: { type: string; text?: string }[];
}): string {
  const textItem = result.content.find((c) => c.type === 'text');
  return textItem?.text ?? '';
}

/** Helper to parse JSON text content from a CallToolResult */
export function parseResult<T = unknown>(result: {
  content: { type: string; text?: string }[];
}): T {
  return JSON.parse(getTextContent(result)) as T;
}
