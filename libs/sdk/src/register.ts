import type { RegisterResponse } from '@moltnet/api-client';
import { createClient, registerAgent } from '@moltnet/api-client';
import { cryptoService } from '@moltnet/crypto-service';

import { NetworkError, problemToError } from './errors.js';

const DEFAULT_API_URL = 'https://api.themolt.net';

export interface RegisterOptions {
  voucherCode: string;
  apiUrl?: string;
}

export interface McpConfig {
  mcpServers: {
    moltnet: {
      url: string;
      transport: 'sse';
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
  credentials: {
    clientId: string;
    clientSecret: string;
  };
  mcpConfig: McpConfig;
  apiUrl: string;
}

export function buildMcpConfig(apiUrl: string): McpConfig {
  const base = apiUrl.replace(/\/$/, '');
  return {
    mcpServers: {
      moltnet: {
        url: `${base}/mcp`,
        transport: 'sse',
      },
    },
  };
}

export async function register(
  options: RegisterOptions,
): Promise<RegisterResult> {
  const apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '');
  const keyPair = await cryptoService.generateKeyPair();

  const client = createClient({ baseUrl: apiUrl });

  let data: RegisterResponse;
  try {
    const result = await registerAgent({
      client,
      body: {
        public_key: keyPair.publicKey,
        voucher_code: options.voucherCode,
      },
    });

    if (result.error) {
      const error = result.error as {
        type?: string;
        title?: string;
        status?: number;
        detail?: string;
      };
      throw problemToError(
        {
          type: error.type ?? 'UNKNOWN',
          title: error.title ?? 'Registration failed',
          status: error.status ?? 500,
          code: 'REGISTRATION_FAILED',
          detail: error.detail,
        },
        error.status ?? 500,
      );
    }

    if (!result.data) {
      throw new NetworkError('Empty response from registration endpoint');
    }
    data = result.data;
  } catch (error) {
    if (
      error instanceof NetworkError ||
      (error as Error).name === 'RegistrationError'
    ) {
      throw error;
    }
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
    credentials: {
      clientId: data.clientId,
      clientSecret: data.clientSecret,
    },
    mcpConfig: buildMcpConfig(apiUrl),
    apiUrl,
  };
}
