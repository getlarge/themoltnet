import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

import type { SignerCeremonyRequest } from '@moltnet/models';

import { renderApprovalPage, renderResultPage } from './approval-page.js';
import {
  SignerCeremonyError,
  type SignerCeremonyService,
} from './ceremony-service.js';

const BODY_LIMIT = 16 * 1024;
const SESSION_HEADER = 'x-moltnet-signer-session';

export function createSignerServer(service: SignerCeremonyService) {
  return createServer((request, response) => {
    void handleRequest(service, request, response);
  });
}

async function handleRequest(
  service: SignerCeremonyService,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  setSecurityHeaders(response);
  try {
    requireLoopbackHost(request);
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'OPTIONS') {
      const origin = requireOrigin(request);
      service.assertOrigin(origin);
      setCors(response, origin);
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      json(response, 200, { status: 'ok' });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/sessions') {
      const origin = requireOrigin(request);
      setCors(response, origin);
      json(response, 201, service.createSession({ origin }));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/ceremonies') {
      const origin = requireOrigin(request);
      setCors(response, origin);
      const sessionToken = requireSessionHeader(request);
      const body = await readJson(request);
      const ceremony = await service.createCeremony({
        origin,
        sessionToken,
        request: body as SignerCeremonyRequest,
      });
      json(response, 201, ceremony);
      return;
    }
    const resultMatch = url.pathname.match(
      /^\/v1\/ceremonies\/([^/]+)\/result$/u,
    );
    if (request.method === 'GET' && resultMatch) {
      const ceremonyId = decodePathSegment(resultMatch);
      const origin = requireOrigin(request);
      setCors(response, origin);
      json(
        response,
        200,
        service.getResult({
          ceremonyId,
          origin,
          sessionToken: requireSessionHeader(request),
        }),
      );
      return;
    }
    const approvalMatch = url.pathname.match(/^\/ceremonies\/([^/]+)$/u);
    if (request.method === 'GET' && approvalMatch) {
      const ceremonyId = decodePathSegment(approvalMatch);
      const approval = service.getApproval(ceremonyId);
      html(response, 200, renderApprovalPage({ ceremonyId, ...approval }));
      return;
    }
    const confirmMatch = url.pathname.match(
      /^\/ceremonies\/([^/]+)\/confirm$/u,
    );
    if (request.method === 'POST' && confirmMatch) {
      const body = await readForm(request);
      await service.confirmCeremony({
        ceremonyId: decodePathSegment(confirmMatch),
        confirmationToken: body.get('confirmationToken') ?? '',
      });
      html(
        response,
        200,
        renderResultPage({
          title: 'Action signed',
          message: 'The signed receipt is ready for the Console.',
          success: true,
        }),
      );
      return;
    }
    json(response, 404, {
      code: 'not_found',
      message: 'Route is not available',
    });
  } catch (error) {
    const signerError =
      error instanceof SignerCeremonyError
        ? error
        : new SignerCeremonyError('ceremony_invalid', 'Request is not valid', {
            cause: error,
          });
    const acceptsHtml = request.headers.accept?.includes('text/html') === true;
    if (acceptsHtml) {
      html(
        response,
        statusFor(signerError),
        renderResultPage({
          title: 'Signing stopped',
          message: signerError.message,
          success: false,
        }),
      );
    } else {
      json(response, statusFor(signerError), {
        code: signerError.code,
        message: signerError.message,
      });
    }
  }
}

function decodePathSegment(match: RegExpMatchArray): string {
  const encoded = match[1];
  if (encoded === undefined) {
    throw new SignerCeremonyError(
      'ceremony_invalid',
      'Ceremony identifier is missing',
    );
  }
  return decodeURIComponent(encoded);
}

function requireLoopbackHost(request: IncomingMessage): void {
  const host = request.headers.host;
  if (!host) throw new Error('Missing Host header');
  const url = new URL(`http://${host}`);
  if (
    url.hostname !== '127.0.0.1' &&
    url.hostname !== 'localhost' &&
    url.hostname !== '[::1]'
  ) {
    throw new Error('Host must be loopback');
  }
}

function requireOrigin(request: IncomingMessage): string {
  const origin = request.headers.origin;
  if (!origin) {
    throw new SignerCeremonyError('origin_not_allowed', 'Origin is required');
  }
  return origin;
}

function requireSessionHeader(request: IncomingMessage): string {
  const token = request.headers[SESSION_HEADER];
  if (typeof token !== 'string' || token.length === 0) {
    throw new SignerCeremonyError(
      'session_invalid',
      'Signer session is required',
    );
  }
  return token;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new SignerCeremonyError(
      'ceremony_invalid',
      'Content-Type must be application/json',
    );
  }
  const bytes = await readBody(request);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new SignerCeremonyError(
      'ceremony_invalid',
      'Request body must be valid UTF-8 JSON',
    );
  }
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  if (
    request.headers['content-type']?.split(';')[0] !==
    'application/x-www-form-urlencoded'
  ) {
    throw new SignerCeremonyError(
      'confirmation_invalid',
      'Confirmation form is invalid',
    );
  }
  return new URLSearchParams(
    new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request)),
  );
}

async function readBody(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > BODY_LIMIT) {
      request.destroy();
      throw new SignerCeremonyError(
        'ceremony_invalid',
        'Request body is too large',
      );
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function setCors(response: ServerResponse, origin: string): void {
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader(
    'access-control-allow-headers',
    `content-type, ${SESSION_HEADER}`,
  );
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  response.setHeader('access-control-max-age', '600');
  response.setHeader('vary', 'Origin');
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader(
    'content-security-policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.setHeader('cross-origin-resource-policy', 'same-origin');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('cache-control', 'no-store');
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function html(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
  });
  response.end(body);
}

function statusFor(error: SignerCeremonyError): number {
  if (error.code === 'origin_not_allowed') return 403;
  if (
    error.code === 'session_invalid' ||
    error.code === 'confirmation_invalid'
  ) {
    return 401;
  }
  if (error.code === 'ceremony_invalid' || error.code === 'challenge_invalid') {
    return 400;
  }
  if (error.code === 'device_failed') return 502;
  return 409;
}
