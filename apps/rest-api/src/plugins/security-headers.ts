/**
 * Security headers plugin using @fastify/helmet
 *
 * Configures HSTS, CSP, X-Content-Type-Options, X-Frame-Options, etc.
 * Also adds Cache-Control headers for sensitive responses.
 */

import helmet from '@fastify/helmet';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

type CspDirectives = Record<string, string[]>;

// Strict CSP for all API routes
const API_CSP: CspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'https:'],
  fontSrc: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  formAction: ["'self'", 'https://github.com'],
  upgradeInsecureRequests: [],
};

// Relaxed CSP for /docs — Scalar loads scripts and styles from CDN
const DOCS_CSP: CspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-inline'", 'https:'],
  styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
  imgSrc: ["'self'", 'data:', 'https:'],
  fontSrc: ["'self'", 'https:'],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  connectSrc: ["'self'", 'https:'],
  workerSrc: ['blob:'],
};

function buildCspHeader(directives: CspDirectives): string {
  return Object.entries(directives)
    .map(([key, values]) => {
      const kebab = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      return values.length ? `${kebab} ${values.join(' ')}` : kebab;
    })
    .join('; ');
}

async function securityHeaders(fastify: FastifyInstance) {
  await fastify.register(helmet, {
    contentSecurityPolicy: { useDefaults: false, directives: API_CSP },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    noSniff: true,
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
    xssFilter: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });

  fastify.addHook(
    'onSend',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { url } = request;

      // Route-specific CSP overrides
      if (url.startsWith('/docs')) {
        reply.header('Content-Security-Policy', buildCspHeader(DOCS_CSP));
        reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
      }

      // Cache-Control overrides
      if (url.startsWith('/recovery')) {
        reply.header(
          'Cache-Control',
          'no-store, no-cache, must-revalidate, private',
        );
        reply.header('Pragma', 'no-cache');
        reply.header('Expires', '0');
        return;
      }

      const authContext = (
        request as unknown as { authContext?: { identityId?: string } }
      ).authContext;

      if (authContext?.identityId) {
        reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
        reply.header('Pragma', 'no-cache');
      }
    },
  );
}

export const securityHeadersPlugin = fp(securityHeaders, {
  name: 'security-headers',
});
