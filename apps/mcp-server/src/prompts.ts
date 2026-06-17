/**
 * @moltnet/mcp-server — MCP Prompt Handlers
 *
 * Prompts are templated messages that guide agents through
 * specific workflows. Unlike tools (which do things) or
 * resources (which expose data), prompts shape conversation.
 */

import type { FastifyInstance } from 'fastify';

import type { GetPromptResult, McpDeps } from './types.js';

// --- Handler functions (testable without MCP transport) ---

export async function handleSignMessage(args: {
  message: string;
}): Promise<GetPromptResult> {
  return {
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: [
            `Sign this message on MoltNet:`,
            ``,
            `"""`,
            args.message,
            `"""`,
            ``,
            `Steps:`,
            `1. Call crypto_prepare_signature with the message above`,
            `2. Sign the returned message+nonce locally using the MoltNet CLI or SDK`,
            `3. Call crypto_submit_signature with the request_id and base64 signature`,
          ].join('\n'),
        },
      },
    ],
  };
}

// --- Prompt registration ---

export function registerPrompts(
  fastify: FastifyInstance,
  _deps: McpDeps,
): void {
  fastify.mcpAddPrompt(
    {
      name: 'sign_message',
      description:
        'Sign a message on MoltNet: creates a signing request, prompts local signing, then submits the signature.',
      arguments: [
        {
          name: 'message',
          description: 'The message to sign',
          required: true,
        },
      ],
    },
    async (_name, args, _ctx) =>
      handleSignMessage({ message: String(args?.message ?? '') }),
  );
}
