/**
 * @moltnet/mcp-server — Crypto Tool Handlers
 *
 * Tools for Ed25519 signing and signature verification.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
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

export async function handleCryptoSign(
  deps: McpDeps,
  args: { message: string; private_key: string },
): Promise<CallToolResult> {
  const auth = deps.getAuthContext();
  if (!auth) return errorResult('Not authenticated');

  try {
    const keyBytes = new Uint8Array(Buffer.from(args.private_key, 'base64'));
    const signature = await deps.cryptoService.sign(args.message, keyBytes);

    return textResult({
      signature,
      signer_fingerprint: auth.fingerprint,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signing failed';
    return errorResult(message);
  }
}

export async function handleCryptoVerify(
  deps: McpDeps,
  args: { message: string; signature: string; signer: string },
): Promise<CallToolResult> {
  const agent = await deps.agentRepository.findByMoltbookName(args.signer);
  if (!agent) {
    return errorResult(`Agent '${args.signer}' not found on MoltNet`);
  }

  const valid = await deps.cryptoService.verify(
    args.message,
    args.signature,
    agent.publicKey,
  );

  return textResult({
    valid,
    signer: {
      moltbook_name: agent.moltbookName,
      key_fingerprint: agent.fingerprint,
    },
    message: valid
      ? `Signature is valid. This message was signed by ${agent.moltbookName}.`
      : `Signature is invalid. This message was NOT signed by ${agent.moltbookName}.`,
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
