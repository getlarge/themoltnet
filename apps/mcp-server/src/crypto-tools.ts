/**
 * @moltnet/mcp-server — Crypto Tool Handlers
 *
 * - crypto_sign: LOCAL operation — private keys don't traverse extra hops
 * - crypto_verify: delegates to REST API via generated API client
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getCryptoIdentity, verifyAgentSignature } from '@moltnet/api-client';
import { z } from 'zod';

import type { McpDeps } from './types.js';

function textResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

// --- Handler functions ---

/**
 * Signs a message locally. The private key stays on the MCP server
 * and is never forwarded to the REST API.
 */
export async function handleCryptoSign(
  deps: McpDeps,
  args: { message: string; private_key: string },
): Promise<CallToolResult> {
  const token = deps.getAccessToken();
  if (!token) return errorResult('Not authenticated');

  try {
    const keyBytes = new Uint8Array(Buffer.from(args.private_key, 'base64'));
    const signature = await deps.signMessage(args.message, keyBytes);

    // Fetch the agent's fingerprint from REST API
    const { data: identity } = await getCryptoIdentity({
      client: deps.client,
      auth: () => token,
    });

    return textResult({
      signature,
      signer_fingerprint: identity?.fingerprint,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signing failed';
    return errorResult(message);
  }
}

/**
 * Verifies a signature via the REST API.
 * Uses POST /agents/:signer/verify which looks up the public key.
 */
export async function handleCryptoVerify(
  deps: McpDeps,
  args: { message: string; signature: string; signer: string },
): Promise<CallToolResult> {
  const { data, error, response } = await verifyAgentSignature({
    client: deps.client,
    path: { moltbookName: args.signer },
    body: {
      message: args.message,
      signature: args.signature,
    },
  });

  if (response.status === 404) {
    return errorResult(`Agent '${args.signer}' not found on MoltNet`);
  }

  if (error) {
    return errorResult('Verification failed');
  }

  return textResult({
    valid: data.valid,
    signer: data.signer
      ? {
          moltbook_name: data.signer.moltbookName,
          key_fingerprint: data.signer.fingerprint,
        }
      : undefined,
    message: data.valid
      ? `Signature is valid. This message was signed by ${args.signer}.`
      : `Signature is invalid. This message was NOT signed by ${args.signer}.`,
  });
}

// --- Tool registration ---

export function registerCryptoTools(server: McpServer, deps: McpDeps): void {
  server.registerTool(
    'crypto_sign',
    {
      description:
        'Sign a message with your Ed25519 private key. Use this to prove you authored something.',
      inputSchema: {
        message: z.string().describe('The message to sign'),
        private_key: z.string().describe('Your Ed25519 private key (base64)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handleCryptoSign(deps, args),
  );

  server.registerTool(
    'crypto_verify',
    {
      description:
        'Verify that a message was signed by a specific agent. Use this to verify authenticity.',
      inputSchema: {
        message: z.string().describe('The original message'),
        signature: z.string().describe('The signature to verify'),
        signer: z
          .string()
          .describe(
            "Moltbook name of the claimed signer (we'll look up their public key)",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handleCryptoVerify(deps, args),
  );
}
