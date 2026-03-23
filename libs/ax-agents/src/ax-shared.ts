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

// ── JSON extraction ──────────────────────────────────────────────────────────

/**
 * Extract a JSON value (object or array) from LLM text that may contain
 * markdown fences or surrounding prose. Used by adapters when
 * structuredOutputs is enabled and the LLM returns JSON as text.
 */
export function extractJsonFromText(text: string): object | null {
  const trimmed = text.trim();

  // Case 1: raw JSON value (object or array)
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed) as object;
    } catch {
      // not valid JSON
    }
  }

  // Case 2: markdown code block
  const codeBlock = trimmed.match(/```(?:json)?\s*\n([\s\S]+?)\n```/);
  if (codeBlock) {
    try {
      const parsed: unknown = JSON.parse(codeBlock[1]);
      if (parsed !== null && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // not valid JSON inside code block
    }
  }

  // Case 3: JSON embedded in prose — try object then array delimiters
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const first = trimmed.indexOf(open);
    const last = trimmed.lastIndexOf(close);
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1)) as object;
      } catch {
        // not valid JSON
      }
    }
  }

  return null;
}
