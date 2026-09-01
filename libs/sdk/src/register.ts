import type { RegisterResponse } from '@moltnet/api-client';
import { createClient, enrollAgent, registerAgent } from '@moltnet/api-client';
import { cryptoService } from '@moltnet/crypto-service';
import {
  type BootstrapCredentialType,
  buildSelfRegistrationMessage,
  buildTeamRegistrationMessage,
} from '@moltnet/models';

import { normalizeOptionalApiUrl } from './api-url.js';
import { deriveMcpUrl } from './credentials.js';
import { MoltNetError, NetworkError, problemToError } from './errors.js';

export { buildSelfRegistrationMessage, buildTeamRegistrationMessage };
export type { BootstrapCredentialType };

export interface RegisterOptions {
  credentialType: BootstrapCredentialType;
  /** Redeem this token into its issuing team instead of self-registering. */
  enrollmentToken?: string;
  apiUrl?: string;
}

export interface EnrollOptions extends Omit<
  RegisterOptions,
  'enrollmentToken'
> {
  enrollmentToken: string;
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

export interface RegisterResult {
  identity: {
    publicKey: string;
    privateKey: string;
    fingerprint: string;
    identityId: string;
  };
  credentials: RegistrationCredentials;
  mcpConfig: McpConfig;
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

export async function register(
  options: RegisterOptions,
): Promise<RegisterResult> {
  const apiUrl = normalizeOptionalApiUrl(options.apiUrl);
  const enrollmentToken = options.enrollmentToken;
  const keyPair = await cryptoService.generateKeyPair();
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
    const send = () =>
      enrollmentToken
        ? enrollAgent({
            ...request,
            body: { ...request.body, token: enrollmentToken },
          })
        : registerAgent(request);
    let result;
    try {
      result = await send();
    } catch {
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
      identityId: data.identityId,
    },
    credentials: data.credential,
    mcpConfig: buildMcpConfig(apiUrl, data.credential),
    apiUrl,
  };
}

export function enroll(options: EnrollOptions): Promise<RegisterResult> {
  return register(options);
}
