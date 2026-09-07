/** Node-only writer for the throwaway credentials used by live evals. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface WriteAgentCredentialsInput {
  /** Root under which `.moltnet/<agentName>/` is created. */
  agentRoot: string;
  agentName: string;
  /**
   * The agent's real identity id. It binds `agent_key_ref` to this agent —
   * the SDK rejects a reference whose key is not `agent-key/<identity_id>` —
   * so a placeholder will not resolve.
   */
  identityId: string;
  /**
   * A live agent-key secret, as returned by `agentKeys.create(...).secret`.
   * Mint it through the eval's OAuth2 agent, exactly as an operator would with
   * `moltnet agents keys create --store`.
   */
  agentKeySecret: string;
  /** The agent's real ed25519 public key. */
  publicKey: string;
  /** The agent's real ed25519 private key. */
  privateKey: string;
  fingerprint: string;
  /** REST API base URL the daemon talks to. */
  apiUrl: string;
}

export interface WrittenAgentCredentials {
  /** `<agentRoot>/.moltnet/<agentName>` — pass as `--agent-root`'s child. */
  agentDir: string;
  /**
   * Absolute root the file secret provider reads from. The daemon resolves
   * `agent_key_ref` only when `MOLTNET_SECRET_ROOT` points here, so callers
   * must export it (and `MOLTNET_SECRET_ROOT_WRITABLE=1` is not needed —
   * the fixture writes the file itself).
   */
  secretRoot: string;
  /** The provider key the config references. */
  secretKey: string;
}

/**
 * Write the credential fixture consumed by live daemon evals.
 *
 * Mirrors what `moltnet agents keys create --store` produces in production: an
 * `agent_key_ref` in `moltnet.json` plus the secret held by a provider. It
 * deliberately does **not** write a plaintext `client_secret` — the daemon
 * stopped accepting OAuth2 client credentials (#2160), so the previous
 * OAuth2-only fixture would now be refused at startup, and it modelled a
 * credential shape production no longer uses.
 */
export function writeAgentCredentials(
  input: WriteAgentCredentialsInput,
): WrittenAgentCredentials {
  const agentDir = join(input.agentRoot, '.moltnet', input.agentName);
  mkdirSync(agentDir, { recursive: true });

  // The file provider maps `agent-key/<identity_id>` to that path under the
  // root, so the directory layout has to mirror the key exactly.
  const secretRoot = join(input.agentRoot, 'secrets');
  const secretKey = `agent-key/${input.identityId}`;
  mkdirSync(join(secretRoot, 'agent-key'), { recursive: true });
  writeFileSync(join(secretRoot, secretKey), input.agentKeySecret, {
    encoding: 'utf8',
    mode: 0o600,
  });

  writeFileSync(
    join(agentDir, 'moltnet.json'),
    JSON.stringify(
      {
        identity_id: input.identityId,
        registered_at: new Date().toISOString(),
        agent_key_ref: { provider: 'file', key: secretKey },
        keys: {
          public_key: input.publicKey,
          private_key: input.privateKey,
          fingerprint: input.fingerprint,
        },
        endpoints: {
          api: input.apiUrl,
          mcp: `${input.apiUrl}/mcp`,
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  writeFileSync(
    join(agentDir, 'env'),
    `MOLTNET_AGENT_NAME=${input.agentName}\n` +
      `MOLTNET_SECRET_ROOT=${secretRoot}\n`,
    'utf8',
  );
  return { agentDir, secretRoot, secretKey };
}
