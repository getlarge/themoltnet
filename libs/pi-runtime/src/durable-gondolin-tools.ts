import type { JsonValue } from '@earendil-works/chord';
import type {
  ExtensionToolContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { ToolRegistration } from '@earendil-works/pi-durable';
import { CodingTools } from '@earendil-works/pi-durable/tools';

import { createGondolinReadToolDefinitions } from './gondolin-tools.js';

/** Reuse our guest read/search implementations; Durable owns shell output spilling. */
export function createDurableGondolinTools(
  config: Parameters<typeof createGondolinReadToolDefinitions>[0] & {
    model: ExtensionToolContext['model'];
  },
): ToolRegistration[] {
  const readTools = adaptDurableTools(
    createGondolinReadToolDefinitions(config),
    {
      cwd: config.cwdPath,
      model: config.model,
    },
    'safe',
  );
  return [
    ...(CodingTools.tools ?? []).filter((tool) => tool.name !== 'read'),
    ...readTools,
  ];
}

/** Existing host tool implementations; session-only APIs fail explicitly. */
export function adaptDurableTools(
  tools: readonly ToolDefinition[],
  input: Pick<ExtensionToolContext, 'cwd' | 'model'>,
  replay: 'safe' | 'unsafe' = 'unsafe',
): ToolRegistration[] {
  const context = new Proxy(
    { ...input, hasUI: false, ui: { confirm: () => Promise.resolve(false) } },
    {
      get(target, property) {
        if (property in target) return Reflect.get(target, property);
        throw new Error(
          `Durable tool requested unsupported session context: ${String(property)}`,
        );
      },
    },
  ) as unknown as ExtensionToolContext;
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    prepareArguments: tool.prepareArguments,
    replay,
    executionMode: 'sequential',
    async execute(args, api, ctx) {
      ctx.abortSignal?.throwIfAborted();
      const result = await tool.execute(
        api.callId,
        args,
        ctx.abortSignal,
        undefined,
        context,
      );
      return {
        content: result.content,
        ...(result.details === undefined
          ? {}
          : {
              details: JSON.parse(JSON.stringify(result.details)) as JsonValue,
            }),
      };
    },
  }));
}
