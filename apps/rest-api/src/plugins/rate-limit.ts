/**
 * Rate limiting plugin using @fastify/rate-limit
 *
 * Configures global and per-route rate limits with RFC 9457 Problem Details
 * format for rate limit exceeded responses.
 */

import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { getTypeUri } from '../problems/registry.js';

export interface RateLimitPluginOptions {
  /** Max requests per minute for authenticated users (default: 100) */
  globalAuthLimit: number;
  /** Max requests per minute for anonymous users (default: 30) */
  globalAnonLimit: number;
  /** Max requests per minute for embedding endpoints (default: 20) */
  embeddingLimit: number;
  /** Max requests per minute for vouch endpoints (default: 10) */
  vouchLimit: number;
  /** Max requests per minute for signing request creation (default: 5) */
  signingLimit: number;
  /** Max requests per minute for recovery endpoints (default: 5) */
  recoveryLimit: number;
  /** Max requests per minute for public verify endpoints (default: 10) */
  publicVerifyLimit: number;
}

/**
 * Build RFC 9457 Problem Details response for rate limit exceeded.
 */
function buildRateLimitResponse(request: FastifyRequest, retryAfter: number) {
  return {
    type: getTypeUri('rate-limit-exceeded'),
    title: 'Rate Limit Exceeded',
    status: 429,
    code: 'RATE_LIMIT_EXCEEDED',
    detail: `Too many requests. Please retry after ${retryAfter} seconds.`,
    instance: request.url,
    retryAfter,
  };
}

async function rateLimitPluginImpl(
  fastify: FastifyInstance,
  options: RateLimitPluginOptions,
) {
  const {
    globalAuthLimit,
    globalAnonLimit,
    embeddingLimit,
    vouchLimit,
    signingLimit,
    recoveryLimit,
    publicVerifyLimit,
  } = options;

  // Register global rate limiter
  await fastify.register(rateLimit, {
    global: true,
    // Use identity ID for authenticated users, IP for anonymous
    keyGenerator: (request: FastifyRequest) => {
      const authContext = (
        request as unknown as { authContext?: { identityId?: string } }
      ).authContext;
      return authContext?.identityId ?? request.ip;
    },
    // Dynamic max based on authentication status
    max: (request: FastifyRequest) => {
      const authContext = (
        request as unknown as { authContext?: { identityId?: string } }
      ).authContext;
      return authContext?.identityId ? globalAuthLimit : globalAnonLimit;
    },
    // 1 minute window
    timeWindow: '1 minute',
    // Add standard rate limit headers
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
    // Custom error response using RFC 9457 Problem Details
    errorResponseBuilder: (
      request: FastifyRequest,
      context: { max: number; ttl: number },
    ) => {
      const retryAfter = Math.ceil(context.ttl / 1000);
      return buildRateLimitResponse(request, retryAfter);
    },
    // Skip rate limiting for health checks
    allowList: (request: FastifyRequest) => {
      return (
        request.url === '/health' ||
        request.url === '/ready' ||
        request.url === '/problems'
      );
    },
  });

  // Store route-specific configs for use in route definitions
  fastify.decorate('rateLimitConfig', {
    embedding: {
      max: embeddingLimit,
      timeWindow: '1 minute',
    },
    vouch: {
      max: vouchLimit,
      timeWindow: '1 minute',
    },
    signing: {
      max: signingLimit,
      timeWindow: '1 minute',
    },
    recovery: {
      max: recoveryLimit,
      timeWindow: '1 minute',
    },
    publicVerify: {
      max: publicVerifyLimit,
      timeWindow: '1 minute',
    },
  });
}

export const rateLimitPlugin = fp(rateLimitPluginImpl, {
  name: 'rate-limit',
});

// Type augmentation for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    rateLimitConfig: {
      embedding: { max: number; timeWindow: string };
      vouch: { max: number; timeWindow: string };
      signing: { max: number; timeWindow: string };
      recovery: { max: number; timeWindow: string };
      publicVerify: { max: number; timeWindow: string };
    };
  }
}
