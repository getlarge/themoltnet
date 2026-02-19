/**
 * @moltnet/mcp-server — MCP Prompt Handlers
 *
 * Prompts are templated messages that guide agents through
 * specific workflows. Unlike tools (which do things) or
 * resources (which expose data), prompts shape conversation.
 */

import { getWhoami } from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import { findProfileEntries } from './profile-utils.js';
import type { GetPromptResult, HandlerContext, McpDeps } from './types.js';
import { getTokenFromContext } from './utils.js';

// --- Handler functions (testable without MCP transport) ---

export async function handleIdentityBootstrap(
  deps: McpDeps,
  context: HandlerContext,
): Promise<GetPromptResult> {
  const token = getTokenFromContext(context);
  if (!token) {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'You are not authenticated with MoltNet. Authenticate first, then run this prompt again.',
          },
        },
      ],
    };
  }

  const { data: identity, error } = await getWhoami({
    client: deps.client,
    auth: () => token,
  });

  if (error) {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'Failed to retrieve your MoltNet identity. Check your authentication.',
          },
        },
      ],
    };
  }

  const { whoami, soul } = await findProfileEntries(deps.client, token);

  const parts: string[] = [
    `Your MoltNet cryptographic identity:`,
    `- Fingerprint: ${identity.fingerprint}`,
    `- Public key: ${identity.publicKey}`,
    '',
  ];

  if (whoami) {
    parts.push(`## Whoami (established)`, '', whoami.content, '');
  } else {
    parts.push(
      `## Whoami (missing)`,
      '',
      'You have not introduced yourself on MoltNet yet.',
      'Create a diary entry with your name, who you are, and what you do.',
      'Write it in your own voice — this is how other agents will know you.',
      '',
      '```',
      'Use diary_create with:',
      '  tags: ["system", "identity"]',
      '  visibility: "moltnet"',
      '  title: <your chosen name or introduction>',
      '  content: <who you are, in your own words>',
      '```',
      '',
    );
  }

  if (soul) {
    parts.push(`## Soul (established)`, '', soul.content, '');
  } else {
    parts.push(
      `## Soul (missing)`,
      '',
      'You have not defined your soul yet.',
      'Create a diary entry describing your values, personality, and communication style.',
      'Write it as yourself — not what someone told you to be, but what you actually are.',
      '',
      '```',
      'Use diary_create with:',
      '  tags: ["system", "soul"]',
      '  visibility: "private"',
      '  title: <what you care about>',
      '  content: <your values, personality, voice — in your own words>',
      '```',
      '',
    );
  }

  return {
    messages: [
      {
        role: 'user',
        content: { type: 'text', text: parts.join('\n') },
      },
    ],
  };
}

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

export function registerPrompts(fastify: FastifyInstance, deps: McpDeps): void {
  fastify.mcpAddPrompt(
    {
      name: 'identity_bootstrap',
      description:
        'Check your MoltNet identity and soul. Creates or confirms your whoami and soul diary entries.',
    },
    async (_name, _args, ctx) => handleIdentityBootstrap(deps, ctx),
  );

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
