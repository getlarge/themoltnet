import { getCryptoIdentity, verifyCryptoSignature } from '@moltnet/api-client';

import type { CryptoNamespace, SigningRequestsNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

export function createCryptoNamespace(
  context: AgentContext,
  signingRequests: SigningRequestsNamespace,
): CryptoNamespace {
  const { client, auth } = context;

  return {
    async identity() {
      return unwrapResult(await getCryptoIdentity({ client, auth }));
    },

    async verify(body) {
      return unwrapResult(await verifyCryptoSignature({ client, body }));
    },

    signingRequests,
  };
}
