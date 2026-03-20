/**
 * ax-shared.ts — Shared utilities for AxAIService adapters.
 *
 * Extracted from ax-claude-agent-sdk.ts and ax-codex-agent-sdk.ts to avoid
 * duplication across local agent SDK wrappers.
 */

import type { AxAIFeatures, AxInternalChatRequest } from '@ax-llm/ax';

// ── Shared feature set ────────────────────────────────────────────────────────

/**
 * Common feature set for local agent SDK adapters.
 * Both Claude Agent SDK and Codex SDK adapters expose this capability profile.
 */
export const AGENT_FEATURES: AxAIFeatures = {
  functions: false,
  structuredOutputs: true,
  streaming: true,
  thinking: false,
  multiTurn: false,
  caching: { supported: false, types: [] },
  media: {
    images: { supported: false, formats: [] },
    audio: { supported: false, formats: [] },
    files: { supported: false, formats: [], uploadMethod: 'none' },
    urls: { supported: false, webSearch: false, contextFetching: false },
  },
};

// ── Prompt flattening ─────────────────────────────────────────────────────────

/**
 * Flatten an Ax chat prompt (multi-turn message array) into a single string
 * suitable for agent SDK adapters that accept a plain text prompt.
 */
export function flattenChatPrompt(
  chatPrompt: AxInternalChatRequest<string>['chatPrompt'],
): string {
  const parts: string[] = [];

  for (const msg of chatPrompt) {
    switch (msg.role) {
      case 'system':
        parts.push(msg.content);
        break;
      case 'user':
        if (typeof msg.content === 'string') {
          parts.push(msg.content);
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if ('text' in block && typeof block.text === 'string') {
              parts.push(block.text);
            }
          }
        }
        break;
      case 'assistant':
        if (msg.content) {
          parts.push(`Assistant: ${msg.content}`);
        }
        break;
      case 'function':
        parts.push(`Function result (${msg.functionId}): ${msg.result}`);
        break;
    }
  }

  return parts.join('\n\n');
}
