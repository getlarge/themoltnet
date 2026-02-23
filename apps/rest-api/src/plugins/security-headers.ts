/**
 * Security headers plugin using @fastify/helmet
 *
 * Configures HSTS, CSP, X-Content-Type-Options, X-Frame-Options, etc.
 * Also adds Cache-Control headers for sensitive responses.
 */

import helmet from '@fastify/helmet';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

// Strict CSP for all API routes
const API_CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'https:'],
  fontSrc: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  formAction: ["'self'"],
  upgradeInsecureRequests: [] as string[],
};

// Relaxed CSP for /docs — Scalar loads scripts and styles from CDN
const DOCS_CSP_DIRECTIVES = {
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

async function securityHeaders(fastify: FastifyInstance) {
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: API_CSP_DIRECTIVES,
    },
    // HTTP Strict Transport Security
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    // Prevent MIME type sniffing
    noSniff: true,
    // Prevent clickjacking
    frameguard: { action: 'deny' },
    // Hide X-Powered-By
    hidePoweredBy: true,
    // XSS protection (legacy, but good to have)
    xssFilter: true,
    // Referrer policy
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // Cross-Origin policies
    crossOriginEmbedderPolicy: false, // May need to be false for some API use cases
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });

  // Override CSP for /docs routes — Scalar API reference loads scripts/styles from CDN
  fastify.addHook(
    'onSend',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.url.startsWith('/docs')) {
        const directives = Object.entries(DOCS_CSP_DIRECTIVES)
          .map(([key, values]) => {
            const kebab = key.replace(/([A-Z])/g, '-$1').toLowerCase();
            return `${kebab} ${values.join(' ')}`;
          })
          .join('; ');
        reply.header('Content-Security-Policy', directives);
        reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
      }
    },
  );

  // Add Cache-Control headers for authenticated and sensitive responses
  fastify.addHook(
    'onSend',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Recovery endpoints get extra strict caching headers (check first, takes precedence)
      if (request.url.startsWith('/recovery')) {
        reply.header(
          'Cache-Control',
          'no-store, no-cache, must-revalidate, private',
        );
        reply.header('Pragma', 'no-cache');
        reply.header('Expires', '0');
        return; // Don't continue, recovery headers are the strictest
      }

      // Check if this is an authenticated request
      const authContext = (
        request as unknown as { authContext?: { identityId?: string } }
      ).authContext;

      if (authContext?.identityId) {
        // Authenticated responses should not be cached
        reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
        reply.header('Pragma', 'no-cache');
      }
    },
  );
}

export const securityHeadersPlugin = fp(securityHeaders, {
  name: 'security-headers',
});
