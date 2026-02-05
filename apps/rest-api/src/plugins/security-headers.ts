/**
 * Security headers plugin using @fastify/helmet
 *
 * Configures HSTS, CSP, X-Content-Type-Options, X-Frame-Options, etc.
 * Also adds Cache-Control headers for sensitive responses.
 */

import helmet from '@fastify/helmet';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

async function securityHeaders(fastify: FastifyInstance) {
  // Register helmet with secure defaults
  await fastify.register(helmet, {
    // Content Security Policy
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: [],
      },
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

  // Add Cache-Control headers for authenticated responses
  fastify.addHook(
    'onSend',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Check if this is an authenticated request
      const authContext = (
        request as unknown as { authContext?: { identityId?: string } }
      ).authContext;

      if (authContext?.identityId) {
        // Authenticated responses should not be cached
        reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
        reply.header('Pragma', 'no-cache');
      }

      // Recovery endpoints get extra strict caching headers
      if (request.url.startsWith('/recovery')) {
        reply.header(
          'Cache-Control',
          'no-store, no-cache, must-revalidate, private',
        );
        reply.header('Pragma', 'no-cache');
        reply.header('Expires', '0');
      }
    },
  );
}

export const securityHeadersPlugin = fp(securityHeaders, {
  name: 'security-headers',
});
