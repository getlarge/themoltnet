import {
  approveSigningCredential,
  beginSigningCredentialRegistration,
  completeSigningCredentialRegistration,
  getSigningCredential,
  listSigningCredentials,
  revokeSigningCredential,
  suspendSigningCredential,
} from '@moltnet/api-client';

import type { SigningCredentialsNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';
import { requiredTeamHeaders } from './team-headers.js';

export function createSigningCredentialsNamespace(
  context: AgentContext,
): SigningCredentialsNamespace {
  const { client, auth } = context;
  return {
    async list(query, options) {
      return unwrapResult(
        await listSigningCredentials({
          client,
          auth,
          headers: requiredTeamHeaders(options),
          query,
        }),
      );
    },
    async get(id, options) {
      return unwrapResult(
        await getSigningCredential({
          client,
          auth,
          headers: requiredTeamHeaders(options),
          path: { id },
        }),
      );
    },
    async startRegistration(body, options) {
      return unwrapResult(
        await beginSigningCredentialRegistration({
          client,
          auth,
          headers: requiredTeamHeaders(options),
          body,
        }),
      );
    },
    async completeRegistration(id, body, options) {
      return unwrapResult(
        await completeSigningCredentialRegistration({
          client,
          auth,
          headers: requiredTeamHeaders(options),
          path: { id },
          body,
        }),
      );
    },
    async approve(id, options) {
      return unwrapResult(
        await approveSigningCredential({
          client,
          auth,
          headers: requiredTeamHeaders(options),
          path: { id },
        }),
      );
    },
    async suspend(id, options) {
      return unwrapResult(
        await suspendSigningCredential({
          client,
          auth,
          headers: requiredTeamHeaders(options),
          path: { id },
        }),
      );
    },
    async revoke(id, options) {
      return unwrapResult(
        await revokeSigningCredential({
          client,
          auth,
          headers: requiredTeamHeaders(options),
          path: { id },
        }),
      );
    },
  };
}
