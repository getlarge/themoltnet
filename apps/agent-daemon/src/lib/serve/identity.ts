/**
 * Serve identity flows (#2061):
 *
 * - `createManagedAgent` — generate + register a fresh agent identity
 *   locally via the SDK (`register()` builds the Ed25519 keypair and signed
 *   proof; supports team enrollment tokens). Secret values land in the
 *   serve FileSecretProvider root under the canonical keys; the store keeps
 *   references only. The seed never leaves this machine or touches the
 *   browser.
 * - `attachExternalAgent` — index an existing `.moltnet/<agent>` config by
 *   PATH (never by copying secrets), verified against the live API
 *   (`whoami`) before it is trusted, per the #1834 server-side-verification
 *   rule.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { connect, register } from '@themoltnet/sdk';
import type { FileSecretProvider } from '@themoltnet/sdk/node';

import {
  type AgentEntry,
  assertStoreName,
  type ExternalAgentEntry,
  type ManagedAgentEntry,
  type ServeStore,
  ServeStoreError,
} from './store.js';

export class ServeIdentityError extends Error {
  override name = 'ServeIdentityError';
  constructor(
    readonly code:
      | 'agent_exists'
      | 'config_not_found'
      | 'verification_failed'
      | 'unsupported_credential',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface CreateManagedAgentInput {
  name: string;
  apiUrl: string;
  enrollmentToken?: string;
}

export async function createManagedAgent(
  store: ServeStore,
  secrets: FileSecretProvider,
  input: CreateManagedAgentInput,
): Promise<ManagedAgentEntry> {
  const name = assertStoreName('agent name', input.name);
  if (store.readAgent(name)) {
    throw new ServeIdentityError(
      'agent_exists',
      `agent "${name}" already exists in the serve store`,
    );
  }

  const result = await register({
    credentialType: 'agent_key',
    apiUrl: input.apiUrl,
    ...(input.enrollmentToken
      ? { enrollmentToken: input.enrollmentToken }
      : {}),
  });
  if (result.credentials.type !== 'agent_key') {
    throw new ServeIdentityError(
      'unsupported_credential',
      `registration returned credential type "${result.credentials.type}"; serve manages agent-key credentials only`,
    );
  }

  const { identityId, fingerprint, publicKey, privateKey } = result.identity;
  // Canonical secret keys (libs/sdk/src/secrets.ts naming) so the Go CLI
  // and a later os-keyring migration interoperate without translation.
  const agentKeyKey = `agent-key/${identityId}`;
  const seedKey = `identity/${fingerprint}/seed`;
  await secrets.write(agentKeyKey, result.credentials.secret);
  await secrets.write(seedKey, privateKey);

  const entry: ManagedAgentEntry = {
    version: 1,
    kind: 'managed',
    agentName: name,
    identityId,
    publicKey,
    fingerprint,
    apiUrl: result.apiUrl,
    agentKeyRef: `file:${agentKeyKey}`,
    privateKeyRef: `file:${seedKey}`,
    createdAt: new Date().toISOString(),
  };
  store.writeAgent(entry);
  return entry;
}

export interface AttachExternalAgentInput {
  name: string;
  /** Absolute path to the `.moltnet/<agent>` directory. */
  configDir: string;
  apiUrl?: string;
}

export async function attachExternalAgent(
  store: ServeStore,
  input: AttachExternalAgentInput,
): Promise<ExternalAgentEntry> {
  const name = assertStoreName('agent name', input.name);
  if (store.readAgent(name)) {
    throw new ServeIdentityError(
      'agent_exists',
      `agent "${name}" already exists in the serve store`,
    );
  }
  if (!existsSync(join(input.configDir, 'moltnet.json'))) {
    throw new ServeIdentityError(
      'config_not_found',
      `no moltnet.json under ${input.configDir}`,
    );
  }

  // Server-side verification before the index trusts local metadata: build
  // an authenticated SDK agent from the referenced config and ask the API
  // who it actually is. Secret resolution goes through the config's own
  // providers (keyring/file/env) — nothing is copied into the serve store.
  let identityId: string | undefined;
  let fingerprint: string | undefined;
  try {
    const agent = await connect({
      configDir: input.configDir,
      ...(input.apiUrl ? { apiUrl: input.apiUrl } : {}),
    });
    const whoami = await agent.agents.whoami();
    identityId = whoami.identityId;
    fingerprint = (whoami as { fingerprint?: string }).fingerprint ?? undefined;
  } catch (cause) {
    throw new ServeIdentityError(
      'verification_failed',
      `could not verify ${input.configDir} against the API: ${(cause as Error).message}`,
      { cause },
    );
  }

  const entry: ExternalAgentEntry = {
    version: 1,
    kind: 'external',
    agentName: name,
    configDir: input.configDir,
    ...(input.apiUrl ? { apiUrl: input.apiUrl } : {}),
    ...(identityId ? { identityId } : {}),
    ...(fingerprint ? { fingerprint } : {}),
    createdAt: new Date().toISOString(),
  };
  store.writeAgent(entry);
  return entry;
}

/** Non-secret projection of an agent entry for `GET` responses. */
export function publicAgentView(entry: AgentEntry): Record<string, unknown> {
  if (entry.kind === 'managed') {
    return {
      kind: entry.kind,
      agentName: entry.agentName,
      identityId: entry.identityId,
      fingerprint: entry.fingerprint,
      apiUrl: entry.apiUrl,
      createdAt: entry.createdAt,
      // Presence booleans only — never reference strings or values.
      hasAgentKey: Boolean(entry.agentKeyRef),
      hasPrivateKey: Boolean(entry.privateKeyRef),
    };
  }
  return {
    kind: entry.kind,
    agentName: entry.agentName,
    configDir: entry.configDir,
    ...(entry.apiUrl ? { apiUrl: entry.apiUrl } : {}),
    ...(entry.identityId ? { identityId: entry.identityId } : {}),
    ...(entry.fingerprint ? { fingerprint: entry.fingerprint } : {}),
    createdAt: entry.createdAt,
  };
}

export function requireAgent(store: ServeStore, name: string): AgentEntry {
  const entry = store.readAgent(name);
  if (!entry) {
    throw new ServeStoreError('not_found', `agent "${name}" is not configured`);
  }
  return entry;
}
