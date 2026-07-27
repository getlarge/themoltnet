import type {
  SignerCeremony,
  SignerCeremonyRequest,
  SignerCeremonyResult,
  SignerSession,
} from '@moltnet/models';
import {
  SignerCeremonyResultSchema,
  SignerCeremonySchema,
  signerProtocolSchemaContext,
  SignerSessionSchema,
} from '@moltnet/models';
import { Value } from 'typebox/value';

const SESSION_HEADER = 'x-moltnet-signer-session';

export interface SignerCompanionClient {
  connect(): Promise<SignerSession>;
  createCeremony(request: SignerCeremonyRequest): Promise<SignerCeremony>;
  getResult(ceremonyId: string): Promise<SignerCeremonyResult>;
  waitForResult(
    ceremonyId: string,
    options?: { signal?: AbortSignal; pollIntervalMs?: number },
  ): Promise<Exclude<SignerCeremonyResult, { status: 'pending' }>>;
}

export function createSignerCompanionClient(options: {
  baseUrl: string;
  fetch?: typeof fetch;
}): SignerCompanionClient {
  const baseUrl = loopbackUrl(options.baseUrl);
  const fetchImpl = options.fetch ?? fetch;
  let session: SignerSession | null = null;

  async function request(
    path: string,
    init: RequestInit,
    includeSession: boolean,
  ): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (includeSession) {
      if (!session || Date.parse(session.expiresAt) <= Date.now()) {
        throw new Error('Signer companion session is not connected');
      }
      headers.set(SESSION_HEADER, session.token);
    }
    const response = await fetchImpl(new URL(path, baseUrl), {
      ...init,
      credentials: 'omit',
      redirect: 'error',
      headers,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        problemMessage(body) ?? 'Signer companion request failed',
      );
    }
    return body;
  }

  async function connect(): Promise<SignerSession> {
    const body = await request('/v1/sessions', { method: 'POST' }, false);
    session = parseSession(body);
    return session;
  }

  async function createCeremony(
    ceremonyRequest: SignerCeremonyRequest,
  ): Promise<SignerCeremony> {
    if (!session) await connect();
    const body = await request(
      '/v1/ceremonies',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ceremonyRequest),
      },
      true,
    );
    return parseCeremony(body);
  }

  async function getResult(ceremonyId: string): Promise<SignerCeremonyResult> {
    const body = await request(
      `/v1/ceremonies/${encodeURIComponent(ceremonyId)}/result`,
      { method: 'GET' },
      true,
    );
    return parseResult(body);
  }

  async function waitForResult(
    ceremonyId: string,
    {
      signal,
      pollIntervalMs = 500,
    }: {
      signal?: AbortSignal;
      pollIntervalMs?: number;
    } = {},
  ): Promise<Exclude<SignerCeremonyResult, { status: 'pending' }>> {
    while (true) {
      signal?.throwIfAborted();
      const result = await getResult(ceremonyId);
      if (result.status !== 'pending') return result;
      await abortableDelay(pollIntervalMs, signal);
    }
  }

  return { connect, createCeremony, getResult, waitForResult };
}

function loopbackUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    (url.hostname !== '127.0.0.1' &&
      url.hostname !== 'localhost' &&
      url.hostname !== '[::1]') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Signer companion URL must be loopback HTTP');
  }
  return url;
}

function parseSession(value: unknown): SignerSession {
  if (
    !Value.Check(signerProtocolSchemaContext, SignerSessionSchema, value) ||
    !isDateTime(value.expiresAt)
  ) {
    throw new Error('Signer companion returned an invalid session');
  }
  return value;
}

function parseCeremony(value: unknown): SignerCeremony {
  if (
    !Value.Check(signerProtocolSchemaContext, SignerCeremonySchema, value) ||
    !isLoopbackApprovalUrl(value.approvalUrl) ||
    !isDateTime(value.expiresAt)
  ) {
    throw new Error('Signer companion returned an invalid ceremony');
  }
  return value;
}

function parseResult(value: unknown): SignerCeremonyResult {
  if (
    !Value.Check(signerProtocolSchemaContext, SignerCeremonyResultSchema, value)
  ) {
    throw new Error('Signer companion returned an invalid result');
  }
  return value;
}

function isDateTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isLoopbackApprovalUrl(value: string): boolean {
  try {
    loopbackUrl(new URL(value).origin);
    return true;
  } catch {
    return false;
  }
}

function problemMessage(value: unknown): string | undefined {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { message?: unknown }).message === 'string'
  ) {
    return (value as { message: string }).message;
  }
  return undefined;
}

function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout);
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException('The operation was aborted', 'AbortError'),
        );
      },
      { once: true },
    );
  });
}
