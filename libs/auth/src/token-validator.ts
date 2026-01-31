/**
 * @moltnet/auth — Token Validation Service
 *
 * Validates OAuth2 access tokens via Ory Hydra introspection
 * and resolves the full AuthContext for authenticated requests.
 */

import type { OAuth2Api } from '@ory/client';
import type { AuthContext, IntrospectionResult } from './types.js';

export interface TokenValidator {
  introspect(token: string): Promise<IntrospectionResult>;
  resolveAuthContext(token: string): Promise<AuthContext | null>;
}

export function createTokenValidator(oauth2Api: OAuth2Api): TokenValidator {
  return {
    async introspect(token: string): Promise<IntrospectionResult> {
      try {
        const { data } = await oauth2Api.introspectOAuth2Token({ token });

        if (!data.active) {
          return { active: false };
        }

        const scopes = data.scope ? data.scope.split(' ').filter(Boolean) : [];

        return {
          active: true,
          clientId: data.client_id ?? '',
          scopes,
          expiresAt: data.exp,
          ext: (data.ext as Record<string, unknown>) ?? {},
        };
      } catch {
        return { active: false };
      }
    },

    async resolveAuthContext(token: string): Promise<AuthContext | null> {
      const result = await this.introspect(token);

      if (!result.active) {
        return null;
      }

      const { clientId, scopes, ext } = result;

      if (!clientId) {
        return null;
      }

      // Try to extract identity info from enriched token claims (via Hydra token hook)
      const identityId = ext['moltnet:identity_id'] as string | undefined;
      const moltbookName = ext['moltnet:moltbook_name'] as string | undefined;
      const publicKey = ext['moltnet:public_key'] as string | undefined;
      const fingerprint = ext['moltnet:key_fingerprint'] as string | undefined;

      if (identityId && moltbookName && publicKey && fingerprint) {
        return {
          identityId,
          moltbookName,
          publicKey,
          fingerprint,
          clientId,
          scopes,
        };
      }

      // Fallback: fetch client metadata from Hydra
      try {
        const { data: client } = await oauth2Api.getOAuth2Client({
          id: clientId,
        });

        const metadata = client.metadata as Record<string, string> | undefined;

        if (!metadata) {
          return null;
        }

        const metaIdentityId = metadata.identity_id;
        const metaMoltbookName = metadata.moltbook_name;
        const metaPublicKey = metadata.public_key;
        const metaFingerprint = metadata.key_fingerprint;

        if (
          !metaIdentityId ||
          !metaMoltbookName ||
          !metaPublicKey ||
          !metaFingerprint
        ) {
          return null;
        }

        return {
          identityId: metaIdentityId,
          moltbookName: metaMoltbookName,
          publicKey: metaPublicKey,
          fingerprint: metaFingerprint,
          clientId,
          scopes,
        };
      } catch {
        return null;
      }
    },
  };
}
