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

import type { McpRegistry } from './mcp-registry.js';
import type {
  CryptoPrepareSignatureInput,
  CryptoSigningStatusInput,
  CryptoSubmitSignatureInput,
  CryptoVerifyInput,
} from './schemas/crypto-schemas.js';
import {
  CryptoPrepareSignatureOutputSchema,
  CryptoPrepareSignatureSchema,
  CryptoSigningStatusOutputSchema,
  CryptoSigningStatusSchema,
  CryptoSubmitSignatureOutputSchema,
  CryptoSubmitSignatureSchema,
  CryptoVerifyOutputSchema,
  CryptoVerifySchema,
} from './schemas/crypto-schemas.js';
import { oauthScopes } from './tool-security.js';
import type { CallToolResult, HandlerContext, McpDeps } from './types.js';
import {
  errorResult,
  extractApiErrorMessage,
  getTokenFromContext,
  structuredResult,
} from './utils.js';

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
  deps.logger.debug({ tool: 'crypto_prepare_signature' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  try {
    const { data, error } = await createSigningRequest({
      client: deps.client,
      auth: () => token,
      body: { message: args.message },
    });

    if (error || !data) {
      deps.logger.error(
        { tool: 'crypto_prepare_signature', err: error },
        'tool.error',
      );
      return errorResult(
        extractApiErrorMessage(error, 'Failed to create signing request'),
      );
    }

    return structuredResult(data);
  } catch (err) {
    deps.logger.error({ tool: 'crypto_prepare_signature', err }, 'tool.error');
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
  deps.logger.debug({ tool: 'crypto_submit_signature' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  try {
    const { data, error } = await submitSignature({
      client: deps.client,
      auth: () => token,
      path: { id: args.request_id },
      body: { signature: args.signature },
    });

    if (error || !data) {
      deps.logger.error(
        { tool: 'crypto_submit_signature', err: error },
        'tool.error',
      );
      return errorResult(
        extractApiErrorMessage(error, 'Failed to submit signature'),
      );
    }

    return structuredResult(data);
  } catch (err) {
    deps.logger.error({ tool: 'crypto_submit_signature', err }, 'tool.error');
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
  deps.logger.debug({ tool: 'crypto_signing_status' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  try {
    const { data, error, response } = await getSigningRequest({
      client: deps.client,
      auth: () => token,
      path: { id: args.request_id },
    });

    if (error || !data) {
      deps.logger.error(
        { tool: 'crypto_signing_status', err: error },
        'tool.error',
      );
      return errorResult(
        extractApiErrorMessage(
          error,
          // No response means the request failed before reaching the API.
          response?.status === 404
            ? 'Signing request not found'
            : 'Failed to get signing request status',
        ),
      );
    }

    return structuredResult(data);
  } catch (err) {
    deps.logger.error({ tool: 'crypto_signing_status', err }, 'tool.error');
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
  deps: McpDeps,
  _context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'crypto_verify' }, 'tool.invoked');
  const { data, error } = await verifyCryptoSignature({
    client: deps.client,
    body: {
      signature: args.signature,
    },
  });

  if (error || !data) {
    deps.logger.error({ tool: 'crypto_verify', err: error }, 'tool.error');
    return errorResult(extractApiErrorMessage(error, 'Verification failed'));
  }

  return structuredResult(data);
}

// --- Tool registration ---

export function registerCryptoTools(
  registry: McpRegistry,
  deps: McpDeps,
): void {
  registry.mcpAddTool(
    {
      name: 'crypto_prepare_signature',
      _meta: { securitySchemes: oauthScopes('crypto:sign') },
      description:
        'Create a signing request. Returns id (request id) and signingInput. ' +
        'Pass signingInput directly to signBytes() from @themoltnet/sdk, ' +
        'then submit the result with crypto_submit_signature.',
      inputSchema: CryptoPrepareSignatureSchema,
      outputSchema: CryptoPrepareSignatureOutputSchema,
    },
    async (args, ctx) => handleCryptoPrepareSignature(args, deps, ctx),
  );

  registry.mcpAddTool(
    {
      name: 'crypto_submit_signature',
      _meta: { securitySchemes: oauthScopes('crypto:sign') },
      description:
        'Submit a locally-produced Ed25519 signature for a signing request. ' +
        'The server verifies it against your registered public key via a DBOS workflow.',
      inputSchema: CryptoSubmitSignatureSchema,
      outputSchema: CryptoSubmitSignatureOutputSchema,
    },
    async (args, ctx) => handleCryptoSubmitSignature(args, deps, ctx),
  );

  registry.mcpAddTool(
    {
      name: 'crypto_signing_status',
      _meta: { securitySchemes: oauthScopes('crypto:sign') },
      description:
        'Check the status of a signing request (pending, completed, or expired).',
      inputSchema: CryptoSigningStatusSchema,
      outputSchema: CryptoSigningStatusOutputSchema,
    },
    async (args, ctx) => handleCryptoSigningStatus(args, deps, ctx),
  );

  registry.mcpAddTool(
    {
      name: 'crypto_verify',
      _meta: { securitySchemes: oauthScopes() },
      description: 'Verify a signature by looking up the signing request.',
      inputSchema: CryptoVerifySchema,
      outputSchema: CryptoVerifyOutputSchema,
    },
    async (args, ctx) => handleCryptoVerify(args, deps, ctx),
  );
}
