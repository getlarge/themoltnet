import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { LoopbackViolationError } from './errors.js';
import { isLoopbackHostname, OriginAllowlist } from './origin.js';

/**
 * Enforce that the `Host` header identifies loopback. Blocks DNS-rebinding
 * setups where a public hostname resolves to 127.0.0.1: the browser then
 * sends that hostname as `Host`, and the request is refused here even
 * though the socket is loopback.
 */
export function requireLoopbackHost(request: FastifyRequest): void {
  const host = request.headers.host;
  if (!host) {
    throw new LoopbackViolationError(
      'host_required',
      'Host header is required',
    );
  }
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    throw new LoopbackViolationError(
      'host_not_loopback',
      'Host header must identify loopback',
    );
  }
  // URL lowercases and keeps IPv6 brackets, matching isLoopbackHostname.
  if (!isLoopbackHostname(hostname === '::1' ? '[::1]' : hostname)) {
    throw new LoopbackViolationError(
      'host_not_loopback',
      'Host header must identify loopback',
    );
  }
}

export interface LoopbackSecurityOptions {
  /** Exact browser origins allowed to call the JSON API via CORS. */
  allowedOrigins?: readonly string[];
  /**
   * Custom CORS origin decision, replacing the `allowedOrigins` allowlist.
   * Used by consumers whose service already owns origin authority (the
   * signer's ceremony service). Must be a pure predicate — never throw.
   * One of `allowedOrigins` or `isOriginAllowed` is required.
   */
  isOriginAllowed?: (origin: string) => boolean;
  /**
   * Additional origins treated as "self" for CORS (e.g. the companion's own
   * loopback base URL used by locally served approval pages).
   */
  selfOrigins?: readonly string[];
  /** Extra request headers allowed through CORS beyond `content-type`. */
  allowedHeaders?: readonly string[];
  /** CORS methods. Default: GET, POST, OPTIONS. */
  methods?: readonly string[];
  /**
   * Override helmet's content-security-policy directives. The default is a
   * deny-everything policy suitable for JSON APIs with small local HTML
   * pages (inline styles only, same-origin form posts).
   */
  contentSecurityPolicyDirectives?: Record<string, readonly string[]>;
}

/**
 * Register the loopback-companion security profile on a Fastify app:
 *
 * - loopback `Host` enforcement on every request;
 * - `cache-control: no-store` on every response;
 * - strict UTF-8 JSON body parsing (invalid bodies raise a typed violation);
 * - exact-origin CORS (opaque/`null` origins get no CORS response but are
 *   not rejected here — route-level controls stay mandatory);
 * - hardened helmet defaults.
 *
 * Returns the allowlist so services can share the same origin decisions.
 */
export function registerLoopbackSecurity(
  app: FastifyInstance,
  options: LoopbackSecurityOptions,
): { allowlist: OriginAllowlist | null } {
  if (!options.allowedOrigins && !options.isOriginAllowed) {
    throw new Error(
      'registerLoopbackSecurity requires allowedOrigins or isOriginAllowed',
    );
  }
  const allowlist = options.allowedOrigins
    ? new OriginAllowlist(options.allowedOrigins)
    : null;
  const selfAllowlist =
    options.selfOrigins && options.selfOrigins.length > 0
      ? new OriginAllowlist(options.selfOrigins)
      : null;
  const isOriginAllowed =
    options.isOriginAllowed ??
    ((origin: string) =>
      allowlist?.has(origin) === true || selfAllowlist?.has(origin) === true);

  app.addHook('onRequest', (request, _reply, done) => {
    requireLoopbackHost(request);
    done();
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store');
    return payload;
  });

  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      try {
        const json = new TextDecoder('utf-8', { fatal: true }).decode(
          typeof body === 'string' ? Buffer.from(body) : body,
        );
        done(null, JSON.parse(json));
      } catch (cause) {
        done(
          new LoopbackViolationError(
            'body_not_utf8_json',
            'Request body must be valid UTF-8 JSON',
            { cause },
          ),
          undefined,
        );
      }
    },
  );

  void app.register(cors, {
    allowedHeaders: ['content-type', ...(options.allowedHeaders ?? [])],
    maxAge: 600,
    methods: [...(options.methods ?? ['GET', 'POST', 'OPTIONS'])],
    origin: (origin, callback) => {
      // Safari may serialize a same-origin loopback form navigation as the
      // opaque Origin value `null`. It does not need a CORS response; the
      // route's own controls (session, pairing, one-time token) remain
      // mandatory.
      if (!origin || origin === 'null') {
        callback(null, false);
        return;
      }
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }
      callback(
        new LoopbackViolationError(
          'origin_not_allowed',
          'Origin is not allowed',
        ),
        false,
      );
    },
  });

  void app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: options.contentSecurityPolicyDirectives ?? {
        baseUri: ["'none'"],
        defaultSrc: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        styleSrc: ["'unsafe-inline'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: false,
    referrerPolicy: { policy: 'no-referrer' },
  });

  return { allowlist };
}
