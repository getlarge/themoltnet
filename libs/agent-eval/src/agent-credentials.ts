/** Node-only writer for the throwaway credentials used by live evals. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface WriteAgentCredentialsInput {
  /** Root under which `.moltnet/<agentName>/` is created. */
  agentRoot: string;
  agentName: string;
  clientId: string;
  clientSecret: string;
  /** The agent's real ed25519 public key. */
  publicKey: string;
  /** The agent's real ed25519 private key. */
  privateKey: string;
  fingerprint: string;
  /** REST API base URL the daemon talks to. */
  apiUrl: string;
}

/** Write the legacy credential fixture consumed by live daemon evals. */
export function writeAgentCredentials(input: WriteAgentCredentialsInput): void {
  const agentDir = join(input.agentRoot, '.moltnet', input.agentName);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, 'moltnet.json'),
    JSON.stringify(
      {
        identity_id: randomUUID(),
        registered_at: new Date().toISOString(),
        oauth2: {
          client_id: input.clientId,
          client_secret: input.clientSecret,
        },
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
    `MOLTNET_AGENT_NAME=${input.agentName}\n`,
    'utf8',
  );
}
