import { CredentialError } from '@themoltnet/credentials';

import type { TokenDeriver } from './broker.js';

export interface TalosDerivationApi {
  adminDeriveToken(input: {
    deriveTokenRequest: {
      algorithm: 'TOKEN_ALGORITHM_JWT';
      credential: string;
      custom_claims: object;
      scopes: string[];
      ttl: string;
    };
  }): Promise<{
    token?: {
      token?: string;
      expire_time?: Date;
    };
  }>;
}

export interface TalosChainedDerivationCapability {
  mode: 'chained' | 'exchange';
  managedParityValidated: boolean;
  derivedJwtChaining: boolean;
}

const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

function classifyTalosFailure(error: unknown): CredentialError {
  if (typeof error === 'object' && error !== null) {
    const upstream = error as { code?: unknown; status?: unknown };
    if (upstream.status === 401 || upstream.status === 403) {
      return new CredentialError(
        'derivation_rejected',
        'Credential derivation was rejected',
      );
    }
    if (
      (typeof upstream.status === 'number' &&
        (upstream.status === 408 ||
          upstream.status === 429 ||
          upstream.status >= 500)) ||
      (typeof upstream.code === 'string' &&
        UNAVAILABLE_CODES.has(upstream.code))
    ) {
      return new CredentialError(
        'derivation_unavailable',
        'Credential derivation service is unavailable',
      );
    }
  }
  return new CredentialError(
    'derivation_failed',
    'Credential derivation failed',
  );
}

export function createTalosTokenDeriver(
  api: TalosDerivationApi,
  capability: TalosChainedDerivationCapability,
): TokenDeriver {
  if (
    capability.mode !== 'chained' ||
    capability.managedParityValidated !== true ||
    capability.derivedJwtChaining !== true
  ) {
    throw new CredentialError(
      'authority_unavailable',
      'Talos chained derivation capability gate is not satisfied',
    );
  }
  return {
    async derive(input) {
      let result: Awaited<ReturnType<TalosDerivationApi['adminDeriveToken']>>;
      try {
        result = await api.adminDeriveToken({
          deriveTokenRequest: {
            algorithm: 'TOKEN_ALGORITHM_JWT',
            credential: input.parentCredential,
            custom_claims: input.customClaims,
            scopes: [...input.scopes],
            ttl: `${input.ttlSeconds}s`,
          },
        });
      } catch (error) {
        throw classifyTalosFailure(error);
      }
      const token = result.token?.token;
      const expiresAt = result.token?.expire_time;
      if (
        !token ||
        !(expiresAt instanceof Date) ||
        Number.isNaN(expiresAt.getTime())
      ) {
        throw new CredentialError(
          'derivation_failed',
          'Credential derivation returned an invalid response',
        );
      }
      return { token, expiresAt };
    },
  };
}
