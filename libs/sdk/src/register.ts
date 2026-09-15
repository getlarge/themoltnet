import type { RegisterResponse } from '@moltnet/api-client';
import { createClient, enrollAgent, registerAgent } from '@moltnet/api-client';
import { cryptoService } from '@moltnet/crypto-service';
import {
  type BootstrapCredentialType,
  buildSelfRegistrationMessage,
  buildTeamRegistrationMessage,
} from '@moltnet/models';

import { withTimeout } from './abort.js';
import {
  normalizeOptionalApiUrl,
  requireSecureCredentialApiUrl,
} from './api-url.js';
import { deriveMcpUrl } from './credentials.js';
import { MoltNetError, NetworkError, problemToError } from './errors.js';

export { buildSelfRegistrationMessage, buildTeamRegistrationMessage };
export type { BootstrapCredentialType };

export type RegistrationKeyPair = Awaited<
  ReturnType<typeof cryptoService.generateKeyPair>
>;

export interface RequestRegistrationOptions {
  credentialType: BootstrapCredentialType;
  /** Redeem this token into its issuing team instead of self-registering. */
  enrollmentToken?: string;
  apiUrl?: string;
  /**
   * Keypair to register. The persisting `register()` in the node entry stores
   * the seed before calling here so a failure after the server commits never
   * loses it; when absent a fresh keypair is generated.
   */
  keyPair?: RegistrationKeyPair;
  /** Abort registration and any replay request. */
  signal?: AbortSignal;
  /**
   * Abort each attempt after this long. Bounding attempts rather than the
   * whole call keeps the replay meaningful after a timed-out first attempt.
   */
  attemptTimeoutMs?: number;
}

export type RegistrationCredentials = RegisterResponse['credential'];

export interface McpConfig {
  mcpServers: {
    moltnet: {
      type: 'http';
      url: string;
      headers:
        | { 'X-Client-Id': string; 'X-Client-Secret': string }
        | { Authorization: string };
    };
  };
}

export interface RegistrationRequestResult {
  identity: {
    publicKey: string;
    privateKey: string;
    fingerprint: string;
    /** Internal `agents.id` — the durable principal. */
    subjectId: string;
    subjectType: 'agent';
  };
  credentials: RegistrationCredentials;
  apiUrl: string;
}

export function createIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

export function buildMcpConfig(
  apiUrl: string,
  credentials:
    | { type: 'oauth2'; clientId: string; clientSecret: string }
    | { type: 'agent_key'; secret: string },
): McpConfig {
  const mcpUrl = deriveMcpUrl(normalizeOptionalApiUrl(apiUrl));
  const headers =
    credentials.type === 'oauth2'
      ? {
          'X-Client-Id': credentials.clientId,
          'X-Client-Secret': credentials.clientSecret,
        }
      : { Authorization: `Bearer ${credentials.secret}` };
  return {
    mcpServers: {
      moltnet: { type: 'http', url: mcpUrl, headers },
    },
  };
}

/**
 * The in-memory registration request: sign the proof, call the API once with
 * a replay on transport failure, and return keys plus credentials without
 * persisting anything. The package root does not export this; the persisting
 * `register()` in `@themoltnet/sdk/node` is the public entry point.
 */
export async function requestRegistration(
  options: RequestRegistrationOptions,
): Promise<RegistrationRequestResult> {
  const apiUrl = requireSecureCredentialApiUrl(
    normalizeOptionalApiUrl(options.apiUrl),
  );
  const enrollmentToken = options.enrollmentToken;
  const keyPair = options.keyPair ?? (await cryptoService.generateKeyPair());
  const idempotencyKey = createIdempotencyKey();
  const tokenHash = enrollmentToken
    ? await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(enrollmentToken),
      )
    : null;
  const message = tokenHash
    ? buildTeamRegistrationMessage({
        enrollmentTokenHash: Array.from(new Uint8Array(tokenHash), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join(''),
        idempotencyKey,
        publicKey: keyPair.publicKey,
        credentialType: options.credentialType,
      })
    : buildSelfRegistrationMessage({
        idempotencyKey,
        publicKey: keyPair.publicKey,
        credentialType: options.credentialType,
      });
  const proof = await cryptoService.sign(message, keyPair.privateKey);
  const client = createClient({ baseUrl: apiUrl });

  let data: RegisterResponse;
  try {
    const request = {
      client,
      headers: { 'idempotency-key': idempotencyKey },
      body: {
        publicKey: keyPair.publicKey,
        proof,
        credentialType: options.credentialType,
      },
    };
    const send = () => {
      const signal =
        options.attemptTimeoutMs === undefined
          ? options.signal
          : withTimeout(options.attemptTimeoutMs, options.signal);
      const attempt = { ...request, ...(signal ? { signal } : {}) };
      return enrollmentToken
        ? enrollAgent({
            ...attempt,
            body: { ...request.body, token: enrollmentToken },
          })
        : registerAgent(attempt);
    };
    let result;
    try {
      result = await send();
    } catch (error) {
      // The caller gave up: a replay with its aborted signal would only fail
      // again and hide why. The caller still sees an unclear outcome, because
      // the aborted request may already have reached the server.
      if (options.signal?.aborted) throw error;
      // A transport failure may mean the server committed but the credential
      // response was dropped. Replay this exact signed request once with the
      // same nonce so the durable workflow returns its recorded result.
      result = await send();
    }

    if (result.error) {
      const problem = result.error;
      throw problemToError(problem, problem.status ?? 500);
    }
    if (!result.data) {
      throw new NetworkError('Empty response from registration endpoint');
    }
    data = result.data;
  } catch (error) {
    if (error instanceof MoltNetError) throw error;
    throw new NetworkError(
      error instanceof Error ? error.message : 'Registration request failed',
      {
        detail:
          error instanceof Error ? error.cause?.toString() : String(error),
      },
    );
  }

  return {
    identity: {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      fingerprint: data.fingerprint,
      subjectId: data.agentId,
      subjectType: 'agent',
    },
    credentials: data.credential,
    apiUrl,
  };
}
