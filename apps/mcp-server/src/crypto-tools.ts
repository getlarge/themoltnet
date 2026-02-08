/**
 * @moltnet/mcp-server — Crypto Tool Handlers
 *
 * Redesigned for key isolation:
 * - crypto_prepare_signature: returns an envelope for the agent to sign locally
 * - crypto_submit_signature: receives a signature, verifies against the agent's known public key
 * - crypto_verify: verifies a signature via REST API (public, no auth needed)
 *
 * The agent's private key never touches this server.
 */

import { getCryptoIdentity, verifyAgentSignature } from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import type {
  CryptoPrepareSignatureInput,
  CryptoSubmitSignatureInput,
  CryptoVerifyInput,
} from './schemas.js';
import {
  CryptoPrepareSignatureSchema,
  CryptoSubmitSignatureSchema,
  CryptoVerifySchema,
} from './schemas.js';
import type { CallToolResult, HandlerContext, McpDeps } from './types.js';
import { errorResult, getTokenFromContext, textResult } from './utils.js';

// --- Handler functions ---

/**
 * Prepares a signing envelope. The agent retrieves their identity
 * and gets back the message + metadata needed to produce a local signature.
 */
export async function handleCryptoPrepareSignature(
  args: CryptoPrepareSignatureInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  try {
    const { data: identity } = await getCryptoIdentity({
      client: deps.client,
      auth: () => token,
    });

    return textResult({
      message: args.message,
      signer_fingerprint: identity?.fingerprint,
      instructions:
        'Sign the message field with your Ed25519 private key (base64 output). ' +
        'Then call crypto_submit_signature with the message and signature.',
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to prepare signature';
    return errorResult(message);
  }
}

/**
 * Receives a locally-produced signature and verifies it against
 * the agent's registered public key via the REST API.
 */
export async function handleCryptoSubmitSignature(
  args: CryptoSubmitSignatureInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  try {
    // Get the agent's identity to know their fingerprint
    const { data: identity } = await getCryptoIdentity({
      client: deps.client,
      auth: () => token,
    });

    if (!identity?.fingerprint) {
      return errorResult('Could not determine your identity');
    }

    // Verify the signature against the agent's known public key
    const { data, error } = await verifyAgentSignature({
      client: deps.client,
      path: { fingerprint: identity.fingerprint },
      body: {
        message: args.message,
        signature: args.signature,
      },
    });

    if (error) {
      return errorResult('Signature verification failed');
    }

    return textResult({
      valid: data.valid,
      signer_fingerprint: identity.fingerprint,
      message: data.valid
        ? 'Signature verified. This message is cryptographically signed by you.'
        : 'Signature is invalid. The signature does not match your registered public key.',
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Signature submission failed';
    return errorResult(message);
  }
}

/**
 * Verifies a signature via the REST API.
 * Public — no auth needed. Looks up the signer's public key by fingerprint.
 */
export async function handleCryptoVerify(
  args: CryptoVerifyInput,
  _deps: McpDeps,
  _context: HandlerContext,
): Promise<CallToolResult> {
  const { data, error, response } = await verifyAgentSignature({
    client: _deps.client,
    path: { fingerprint: args.signer_fingerprint },
    body: {
      message: args.message,
      signature: args.signature,
    },
  });

  if (response.status === 404) {
    return errorResult(
      `Agent with fingerprint '${args.signer_fingerprint}' not found on MoltNet`,
    );
  }

  if (error) {
    return errorResult('Verification failed');
  }

  return textResult({
    valid: data.valid,
    signer: data.signer ? { fingerprint: data.signer.fingerprint } : undefined,
    message: data.valid
      ? `Signature is valid. This message was signed by ${args.signer_fingerprint}.`
      : `Signature is invalid. This message was NOT signed by ${args.signer_fingerprint}.`,
  });
}

// --- Tool registration ---

export function registerCryptoTools(
  fastify: FastifyInstance,
  deps: McpDeps,
): void {
  fastify.mcpAddTool(
    {
      name: 'crypto_prepare_signature',
      description:
        'Prepare a message for signing. Returns an envelope with your identity. ' +
        'Sign the message locally with your Ed25519 private key, then call crypto_submit_signature.',
      inputSchema: CryptoPrepareSignatureSchema,
    },
    async (args, ctx) => handleCryptoPrepareSignature(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'crypto_submit_signature',
      description:
        'Submit a locally-produced Ed25519 signature. ' +
        'The server verifies it against your registered public key.',
      inputSchema: CryptoSubmitSignatureSchema,
    },
    async (args, ctx) => handleCryptoSubmitSignature(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'crypto_verify',
      description:
        'Verify that a message was signed by a specific agent. Use this to verify authenticity.',
      inputSchema: CryptoVerifySchema,
    },
    async (args, ctx) => handleCryptoVerify(args, deps, ctx),
  );
}
