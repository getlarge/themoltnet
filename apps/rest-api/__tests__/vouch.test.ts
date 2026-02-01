import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createMockVoucher,
  createTestApp,
  type MockServices,
  OWNER_ID,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

describe('Vouch routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  describe('POST /vouch', () => {
    it('issues a voucher code for authenticated agent', async () => {
      const voucher = createMockVoucher();
      mocks.voucherRepository.issue.mockResolvedValue(voucher);

      const response = await app.inject({
        method: 'POST',
        url: '/vouch',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.code).toBe(voucher.code);
      expect(body.expiresAt).toBeDefined();
      expect(body.issuedBy).toBe('Claude');
      expect(mocks.voucherRepository.issue).toHaveBeenCalledWith(OWNER_ID);
    });

    it('returns 429 when voucher limit reached', async () => {
      mocks.voucherRepository.issue.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/vouch',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(429);
      expect(response.json().error).toBe('VOUCHER_LIMIT');
    });

    it('returns 401 without auth', async () => {
      const unauthApp = await createTestApp(mocks, null);

      const response = await unauthApp.inject({
        method: 'POST',
        url: '/vouch',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /vouch/active', () => {
    it('lists active vouchers for authenticated agent', async () => {
      const vouchers = [
        createMockVoucher(),
        createMockVoucher({ code: 'b'.repeat(64) }),
      ];
      mocks.voucherRepository.listActiveByIssuer.mockResolvedValue(vouchers);

      const response = await app.inject({
        method: 'GET',
        url: '/vouch/active',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.vouchers).toHaveLength(2);
      expect(mocks.voucherRepository.listActiveByIssuer).toHaveBeenCalledWith(
        OWNER_ID,
      );
    });

    it('returns empty list when no active vouchers', async () => {
      mocks.voucherRepository.listActiveByIssuer.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/vouch/active',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().vouchers).toHaveLength(0);
    });
  });

  describe('GET /vouch/graph', () => {
    it('returns the trust graph (public, no auth required)', async () => {
      const unauthApp = await createTestApp(mocks, null);
      mocks.voucherRepository.getTrustGraph.mockResolvedValue([
        {
          issuer: 'Claude',
          redeemer: 'Aria',
          redeemedAt: new Date('2026-01-31T10:00:00Z'),
        },
      ]);

      const response = await unauthApp.inject({
        method: 'GET',
        url: '/vouch/graph',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.edges).toHaveLength(1);
      expect(body.edges[0].issuer).toBe('Claude');
      expect(body.edges[0].redeemer).toBe('Aria');
    });

    it('returns empty graph when no vouchers redeemed', async () => {
      mocks.voucherRepository.getTrustGraph.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/vouch/graph',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().edges).toHaveLength(0);
    });
  });
});
