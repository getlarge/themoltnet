import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@moltnet/api-client', () => ({
  issueVoucher: vi.fn(),
  listActiveVouchers: vi.fn(),
  getTrustGraph: vi.fn(),
}));

import {
  getTrustGraph,
  issueVoucher,
  listActiveVouchers,
} from '@moltnet/api-client';

import type { McpDeps } from '../src/types.js';
import type { HandlerContext } from '../src/types.js';
import {
  handleIssueVoucher,
  handleListVouchers,
  handleTrustGraph,
} from '../src/vouch-tools.js';
import {
  createMockContext,
  createMockDeps,
  getTextContent,
  parseResult,
  sdkErr,
  sdkOk,
} from './helpers.js';

describe('vouch-tools', () => {
  let deps: McpDeps;
  let context: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    context = createMockContext();
  });

  // ── moltnet_vouch (handleIssueVoucher) ──

  describe('handleIssueVoucher', () => {
    it('issues a voucher successfully', async () => {
      const voucher = {
        code: 'abc123',
        expiresAt: '2026-02-09T00:00:00Z',
      };
      vi.mocked(issueVoucher).mockResolvedValue(sdkOk(voucher) as never);

      const result = await handleIssueVoucher(
        {} as Record<string, never>,
        deps,
        context,
      );

      expect(result.isError).toBeUndefined();
      const parsed = parseResult<{
        voucher: typeof voucher;
        instructions: string;
      }>(result);
      expect(parsed.voucher).toEqual(voucher);
      expect(parsed.instructions).toContain('24 hours');
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);

      const result = await handleIssueVoucher(
        {} as Record<string, never>,
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });

    it('returns error when API fails', async () => {
      vi.mocked(issueVoucher).mockResolvedValue(
        sdkErr({
          error: 'Forbidden',
          message: 'Max vouchers reached',
          statusCode: 403,
        }) as never,
      );

      const result = await handleIssueVoucher(
        {} as Record<string, never>,
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Max vouchers reached');
    });

    it('falls back to generic message when error message is undefined', async () => {
      vi.mocked(issueVoucher).mockResolvedValue(
        sdkErr({
          error: 'Forbidden',
          message: undefined as unknown as string,
          statusCode: 403,
        }) as never,
      );

      const result = await handleIssueVoucher(
        {} as Record<string, never>,
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Failed to issue voucher');
    });
  });

  // ── moltnet_vouchers (handleListVouchers) ──

  describe('handleListVouchers', () => {
    it('lists active vouchers', async () => {
      const vouchers = [
        { code: 'abc', expiresAt: '2026-02-09T00:00:00Z' },
        { code: 'def', expiresAt: '2026-02-10T00:00:00Z' },
      ];
      vi.mocked(listActiveVouchers).mockResolvedValue(sdkOk(vouchers) as never);

      const result = await handleListVouchers(
        {} as Record<string, never>,
        deps,
        context,
      );

      expect(result.isError).toBeUndefined();
      const parsed = parseResult<typeof vouchers>(result);
      expect(parsed).toHaveLength(2);
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);

      const result = await handleListVouchers(
        {} as Record<string, never>,
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });

    it('returns error when API fails', async () => {
      vi.mocked(listActiveVouchers).mockResolvedValue(
        sdkErr({
          error: 'InternalServerError',
          message: 'DB error',
          statusCode: 500,
        }) as never,
      );

      const result = await handleListVouchers(
        {} as Record<string, never>,
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Failed to list vouchers');
    });
  });

  // ── moltnet_trust_graph (handleTrustGraph) ──

  describe('handleTrustGraph', () => {
    it('fetches trust graph', async () => {
      const graph = {
        nodes: [{ fingerprint: 'AAAA-BBBB-CCCC-DDDD' }],
        edges: [{ from: 'AAAA-BBBB-CCCC-DDDD', to: 'EEEE-FFFF-0000-1111' }],
      };
      vi.mocked(getTrustGraph).mockResolvedValue(sdkOk(graph) as never);

      const result = await handleTrustGraph(
        {} as Record<string, never>,
        deps,
        context,
      );

      expect(result.isError).toBeUndefined();
      const parsed = parseResult<typeof graph>(result);
      expect(parsed.nodes).toHaveLength(1);
      expect(parsed.edges).toHaveLength(1);
    });

    it('does not require authentication', async () => {
      const graph = { nodes: [], edges: [] };
      vi.mocked(getTrustGraph).mockResolvedValue(sdkOk(graph) as never);
      const unauthContext = createMockContext(null);

      const result = await handleTrustGraph(
        {} as Record<string, never>,
        deps,
        unauthContext,
      );

      expect(result.isError).toBeUndefined();
      const parsed = parseResult<typeof graph>(result);
      expect(parsed.edges).toBeDefined();
    });

    it('returns error when API fails', async () => {
      vi.mocked(getTrustGraph).mockResolvedValue(
        sdkErr({
          error: 'InternalServerError',
          message: 'Network error',
          statusCode: 500,
        }) as never,
      );

      const result = await handleTrustGraph(
        {} as Record<string, never>,
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Failed to fetch trust graph');
    });
  });
});
