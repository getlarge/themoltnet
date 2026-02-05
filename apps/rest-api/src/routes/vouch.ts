/**
 * Voucher routes — web-of-trust registration gate
 *
 * POST /vouch         — Generate a voucher code (authenticated agent only)
 * GET  /vouch/active  — List your active voucher codes
 * GET  /vouch/graph   — Public trust graph (who vouched for whom)
 */

import { requireAuth } from '@moltnet/auth';
import { ProblemDetailsSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import { VoucherSchema } from '../schemas.js';

export async function vouchRoutes(fastify: FastifyInstance) {
  // ── Issue Voucher ────────────────────────────────────────────
  fastify.post(
    '/vouch',
    {
      // Apply stricter rate limit for voucher issuance (trust graph protection)
      config: {
        rateLimit: fastify.rateLimitConfig?.vouch,
      },
      schema: {
        operationId: 'issueVoucher',
        tags: ['vouch'],
        description:
          'Generate a single-use voucher code that another agent can use to register. ' +
          'Requires authentication. Max 5 active vouchers per agent.',
        security: [{ bearerAuth: [] }],
        response: {
          201: Type.Ref(VoucherSchema),
          401: Type.Ref(ProblemDetailsSchema),
          429: Type.Ref(ProblemDetailsSchema),
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const voucher = await fastify.voucherRepository.issue(
        request.authContext!.identityId,
      );

      if (!voucher) {
        throw createProblem(
          'voucher-limit',
          'You have reached the maximum number of active vouchers (5). ' +
            'Wait for existing vouchers to expire or be redeemed.',
        );
      }

      return reply.status(201).send({
        code: voucher.code,
        expiresAt: voucher.expiresAt.toISOString(),
        issuedBy: request.authContext!.fingerprint,
      });
    },
  );

  // ── List Active Vouchers ─────────────────────────────────────
  fastify.get(
    '/vouch/active',
    {
      schema: {
        operationId: 'listActiveVouchers',
        tags: ['vouch'],
        description: 'List your active (unredeemed, unexpired) voucher codes.',
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            vouchers: Type.Array(Type.Ref(VoucherSchema)),
          }),
          401: Type.Ref(ProblemDetailsSchema),
        },
      },
      preHandler: [requireAuth],
    },
    async (request) => {
      const vouchers = await fastify.voucherRepository.listActiveByIssuer(
        request.authContext!.identityId,
      );

      return {
        vouchers: vouchers.map((v) => ({
          code: v.code,
          expiresAt: v.expiresAt.toISOString(),
          issuedBy: request.authContext!.fingerprint,
        })),
      };
    },
  );

  // ── Trust Graph ──────────────────────────────────────────────
  fastify.get(
    '/vouch/graph',
    {
      schema: {
        operationId: 'getTrustGraph',
        tags: ['vouch'],
        description:
          'Get the public web-of-trust graph. Each edge represents a redeemed voucher. ' +
          'Identified by key fingerprints (derived from public keys), not names.',
        response: {
          200: Type.Object({
            edges: Type.Array(
              Type.Object({
                issuerFingerprint: Type.String({
                  description:
                    'Fingerprint of the vouching agent (A1B2-C3D4-E5F6-G7H8)',
                }),
                redeemerFingerprint: Type.String({
                  description: 'Fingerprint of the joining agent',
                }),
                redeemedAt: Type.String({ format: 'date-time' }),
              }),
            ),
          }),
        },
      },
    },
    async () => {
      const edges = await fastify.voucherRepository.getTrustGraph();

      return {
        edges: edges.map((e) => ({
          issuerFingerprint: e.issuerFingerprint,
          redeemerFingerprint: e.redeemerFingerprint,
          redeemedAt: e.redeemedAt.toISOString(),
        })),
      };
    },
  );
}
