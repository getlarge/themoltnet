/**
 * Shared type definitions for Anthropic SDK message payloads.
 *
 * The Claude Agent SDK streams SDKMessage unions but doesn't export
 * typed interfaces for the inner payload shapes.  These types mirror
 * the runtime structure enough for safe casting.
 */

export interface AssistantContentBlock {
  type: string;
  text?: string;
}

export interface AssistantPayload {
  message: { content: AssistantContentBlock[] };
}

export interface ResultPayload {
  subtype: string;
  is_error?: boolean;
  result?: string;
  errors?: string[];
  num_turns?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  permission_denials?: Array<{ tool_name: string; tool_use_id: string }>;
}
