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

export function createTalosTokenDeriver(api: TalosDerivationApi): TokenDeriver {
  return {
    async derive(input) {
      try {
        const result = await api.adminDeriveToken({
          deriveTokenRequest: {
            algorithm: 'TOKEN_ALGORITHM_JWT',
            credential: input.parentCredential,
            custom_claims: input.customClaims,
            scopes: [...input.scopes],
            ttl: `${input.ttlSeconds}s`,
          },
        });
        const token = result.token?.token;
        const expiresAt = result.token?.expire_time;
        if (!token || !expiresAt || Number.isNaN(expiresAt.getTime())) {
          throw new Error('incomplete Talos response');
        }
        return { token, expiresAt };
      } catch {
        throw new CredentialError(
          'derivation_failed',
          'Credential derivation failed',
        );
      }
    },
  };
}
