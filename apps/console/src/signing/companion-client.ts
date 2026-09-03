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
import {
  createClient,
  createSignerCeremony,
  createSignerSession,
  getSignerCeremonyResult,
  type RequestResult,
} from '@moltnet/signer-api-client';
import { Value } from 'typebox/value';

import { abortableDelay } from '../abortable-delay.js';
import { loopbackFetch, loopbackHttpUrl } from '../loopback-url.js';

export interface SignerCompanionClient {
  connect(): Promise<SignerSession>;
  createCeremony(request: SignerCeremonyRequest): Promise<SignerCeremony>;
  getResult(
    ceremonyId: string,
    options?: { signal?: AbortSignal },
  ): Promise<SignerCeremonyResult>;
  waitForResult(
    ceremonyId: string,
    options?: { signal?: AbortSignal; pollIntervalMs?: number },
  ): Promise<Exclude<SignerCeremonyResult, { status: 'pending' }>>;
}

export class SignerCompanionError extends Error {
  public readonly status: number | undefined;

  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions & { status?: number },
  ) {
    super(message, options);
    this.name = 'SignerCompanionError';
    this.status = options?.status;
  }
}

export function createSignerCompanionClient(options: {
  baseUrl: string;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
}): SignerCompanionClient {
  const baseUrl = loopbackHttpUrl(options.baseUrl, 'Signer companion');
  const fetchImpl = options.fetch ?? fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
  const transport = createClient({
    baseUrl: baseUrl.href,
    credentials: 'omit',
    fetch: (input, init) => loopbackFetch(fetchImpl, input, init),
    redirect: 'error',
  });
  let session: SignerSession | null = null;

  async function connect(): Promise<SignerSession> {
    const body = await unwrapTransport(
      createSignerSession({
        client: transport,
        headers: { accept: 'application/json' },
        signal: combineSignals(undefined, requestTimeoutMs),
      }),
    );
    session = parseSession(body);
    return session;
  }

  async function createCeremony(
    ceremonyRequest: SignerCeremonyRequest,
  ): Promise<SignerCeremony> {
    if (!session) await connect();
    const token = activeSessionToken(session);
    const body = await unwrapTransport(
      createSignerCeremony({
        auth: token,
        body: ceremonyRequest,
        client: transport,
        headers: { accept: 'application/json' },
        signal: combineSignals(undefined, requestTimeoutMs),
      }),
    );
    return parseCeremony(body);
  }

  async function getResult(
    ceremonyId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<SignerCeremonyResult> {
    const token = activeSessionToken(session);
    const body = await unwrapTransport(
      getSignerCeremonyResult({
        auth: token,
        client: transport,
        headers: { accept: 'application/json' },
        path: { ceremonyId },
        signal: combineSignals(options.signal, requestTimeoutMs),
      }),
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
      const result = await getResult(ceremonyId, { signal });
      if (result.status !== 'pending') return result;
      await abortableDelay(pollIntervalMs, signal);
    }
  }

  return { connect, createCeremony, getResult, waitForResult };
}

function activeSessionToken(session: SignerSession | null): string {
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    throw new SignerCompanionError(
      'session_invalid',
      'Signer companion session is not connected',
    );
  }
  return session.token;
}

type TransportRequest<T> = RequestResult<
  { response: T },
  { error: unknown },
  false
>;

async function unwrapTransport<T>(request: TransportRequest<T>): Promise<T> {
  let result: Awaited<typeof request>;
  try {
    result = await request;
  } catch (error) {
    throw unavailableError(error);
  }
  if (result.error !== undefined) {
    if (!result.response) {
      throw unavailableError(result.error);
    }
    throw new SignerCompanionError(
      problemCode(result.error) ?? `http_${result.response.status}`,
      problemMessage(result.error) ??
        textErrorMessage(result.error) ??
        'Signer companion request failed',
      {
        cause: result.error,
        status: result.response.status,
      },
    );
  }
  if (result.data === undefined) {
    throw new SignerCompanionError(
      'invalid_response',
      'Signer companion returned an empty response',
    );
  }
  return result.data;
}

function unavailableError(error: unknown): SignerCompanionError {
  return new SignerCompanionError(
    error instanceof DOMException && error.name === 'TimeoutError'
      ? 'request_timeout'
      : 'companion_unavailable',
    'Local signer companion is unavailable',
    { cause: error },
  );
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
    loopbackHttpUrl(new URL(value).origin, 'Signer companion');
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

function problemCode(value: unknown): string | undefined {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { code?: unknown }).code === 'string'
  ) {
    return (value as { code: string }).code;
  }
  return undefined;
}

function textErrorMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const message = value.trim();
  return message.length > 0 ? message : undefined;
}

function combineSignals(
  signal: AbortSignal | null | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
