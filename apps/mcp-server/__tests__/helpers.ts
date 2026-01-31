/**
 * Test helpers — mocks and fixtures for MCP server tests
 *
 * Mocks the ApiClient methods instead of service interfaces,
 * since the MCP server communicates with the REST API via HTTP.
 */

import { vi } from 'vitest';
import type { ApiClient, ApiResponse } from '../src/api-client.js';
import type { McpDeps } from '../src/types.js';

export const TOKEN = 'test-bearer-token';
export const ENTRY_ID = '770e8400-e29b-41d4-a716-446655440002';

export interface MockApi {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
}

export function createMockApi(): MockApi {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  };
}

/**
 * Create McpDeps with mocked API client.
 * Pass `null` for token to simulate unauthenticated state.
 */
export function createMockDeps(
  mockApi: MockApi,
  token: string | null = TOKEN,
): McpDeps {
  return {
    api: mockApi as unknown as ApiClient,
    getAccessToken: () => token,
    signMessage: vi.fn().mockResolvedValue('ed25519:sig123'),
  };
}

/** Helper to build an OK API response */
export function okResponse<T>(data: T): ApiResponse<T> {
  return { status: 200, ok: true, data };
}

/** Helper to build a 201 Created response */
export function createdResponse<T>(data: T): ApiResponse<T> {
  return { status: 201, ok: true, data };
}

/** Helper to build an error API response */
export function errorResponse(
  status: number,
  data: { error: string; message: string; statusCode: number },
): ApiResponse<unknown> {
  return { status, ok: false, data };
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
