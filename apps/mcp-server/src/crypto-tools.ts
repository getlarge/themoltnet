/**
 * @moltnet/mcp-server — Crypto Tool Handlers
 *
 * - crypto_prepare_signature: creates a signing request via REST API (DBOS workflow)
 * - crypto_submit_signature: submits a locally-created signature
 * - crypto_signing_status: checks signing request status
 * - crypto_verify: verifies a signature via REST API (public, no auth needed)
 *
 * Private keys never leave the agent's runtime. The agent signs locally
 * and submits the signature to the DBOS durable workflow.
 */

import {
  createSigningRequest,
  getSigningRequest,
  submitSignature,
  verifyCryptoSignature,
} from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import type {
  CryptoPrepareSignatureInput,
  CryptoSigningStatusInput,
  CryptoSubmitSignatureInput,
  CryptoVerifyInput,
} from './schemas.js';
import {
  CryptoPrepareSignatureSchema,
  CryptoSigningStatusSchema,
  CryptoSubmitSignatureSchema,
  CryptoVerifySchema,
} from './schemas.js';
import type { CallToolResult, HandlerContext, McpDeps } from './types.js';
import { errorResult, getTokenFromContext, textResult } from './utils.js';

// --- Handler functions ---

/**
 * Creates a signing request via the REST API (DBOS workflow).
 * Returns the request ID, message, nonce, and how-to instructions for the agent.
 */
export async function handleCryptoPrepareSignature(
  args: CryptoPrepareSignatureInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  try {
    const { data, error } = await createSigningRequest({
      client: deps.client,
      auth: () => token,
      body: { message: args.message },
    });

    if (error) {
      return errorResult('Failed to create signing request');
    }

    return textResult({
      request_id: data.id,
      message: data.message,
      nonce: data.nonce,
      signing_input: data.signingInput,
      status: data.status,
      expires_at: data.expiresAt,
      next_step:
        'Base64-decode signing_input, sign the raw bytes with Ed25519 (no additional framing), ' +
        'base64-encode the result, then call crypto_submit_signature with the signature.',
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to prepare signature';
    return errorResult(message);
  }
}

/**
 * Submits a signature to a signing request via the REST API.
 * The DBOS workflow verifies the signature server-side.
 */
export async function handleCryptoSubmitSignature(
  args: CryptoSubmitSignatureInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  try {
    const { data, error } = await submitSignature({
      client: deps.client,
      auth: () => token,
      path: { id: args.request_id },
      body: { signature: args.signature },
    });

    if (error) {
      return errorResult('Failed to submit signature');
    }

    return textResult({
      request_id: data.id,
      status: data.status,
      valid: data.valid,
      message: data.valid
        ? 'Signature verified successfully.'
        : data.status === 'expired'
          ? 'Signing request expired before signature was submitted.'
          : 'Signature verification failed.',
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to submit signature';
    return errorResult(message);
  }
}

/**
 * Checks the status of a signing request via the REST API.
 */
export async function handleCryptoSigningStatus(
  args: CryptoSigningStatusInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  try {
    const { data, error, response } = await getSigningRequest({
      client: deps.client,
      auth: () => token,
      path: { id: args.request_id },
    });

    if (response.status === 404) {
      return errorResult('Signing request not found');
    }

    if (error) {
      return errorResult('Failed to get signing request status');
    }

    return textResult({
      request_id: data.id,
      status: data.status,
      valid: data.valid,
      message: data.message,
      expires_at: data.expiresAt,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to get signing status';
    return errorResult(message);
  }
}

/**
 * Verifies a signature via the REST API.
 * Public — no auth needed. Looks up the signing request by signature.
 */
export async function handleCryptoVerify(
  args: CryptoVerifyInput,
  _deps: McpDeps,
  _context: HandlerContext,
): Promise<CallToolResult> {
  const { data, error } = await verifyCryptoSignature({
    client: _deps.client,
    body: {
      signature: args.signature,
    },
  });

  if (error) {
    return errorResult('Verification failed');
  }

  return textResult({
    valid: data.valid,
    message: data.valid
      ? 'Signature is valid.'
      : 'Signature is invalid or unknown.',
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
        'Create a signing request. Returns request_id, message, nonce, and signing_input. ' +
        'signing_input is the exact base64-encoded bytes to sign with Ed25519 — ' +
        'base64-decode it, sign the raw bytes, then call crypto_submit_signature.',
      inputSchema: CryptoPrepareSignatureSchema,
    },
    async (args, ctx) => handleCryptoPrepareSignature(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'crypto_submit_signature',
      description:
        'Submit a locally-produced Ed25519 signature for a signing request. ' +
        'The server verifies it against your registered public key via a DBOS workflow.',
      inputSchema: CryptoSubmitSignatureSchema,
    },
    async (args, ctx) => handleCryptoSubmitSignature(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'crypto_signing_status',
      description:
        'Check the status of a signing request (pending, completed, or expired).',
      inputSchema: CryptoSigningStatusSchema,
    },
    async (args, ctx) => handleCryptoSigningStatus(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'crypto_verify',
      description: 'Verify a signature by looking up the signing request.',
      inputSchema: CryptoVerifySchema,
    },
    async (args, ctx) => handleCryptoVerify(args, deps, ctx),
  );
}
