/**
 * Tool, resource and prompt registry for the official MCP server.
 *
 * The HTTP transport is stateless, so a fresh `McpServer` is built for every
 * request. Registration happens once at startup against this registry, which
 * enforces MoltNet's tool policies up front and replays the definitions onto
 * each server. Its `mcpAddTool` / `mcpAddResource` / `mcpAddPrompt` signatures
 * match the ones the tool modules already use.
 */
import {
  type AuthInfo,
  McpServer,
  ResourceTemplate,
  type ServerContext,
} from '@modelcontextprotocol/server';
import type { CredentialScope } from '@moltnet/models';
import { type Static, type TObject, Type } from 'typebox';

import type { McpAppResourceMetaOptions } from './mcp-app-ui.js';
import { annotationsForTool } from './tool-annotations.js';
import { securitySchemesOf, withScopeChallenge } from './tool-security.js';
import { typebox } from './typebox-schema.js';
import type {
  CallToolResult,
  GetPromptResult,
  HandlerContext,
  ReadResourceResult,
} from './types.js';
import { errorResult } from './utils.js';

export interface ToolDefinition<TInput extends TObject = TObject> {
  name: string;
  title?: string;
  description?: string;
  inputSchema: TInput;
  outputSchema?: TObject;
  /** Must carry `securitySchemes` (see `oauthScopes`). */
  _meta?: Record<string, unknown>;
}

export type ToolHandler<TInput extends TObject = TObject> = (
  params: Static<TInput>,
  context: HandlerContext,
) => CallToolResult | Promise<CallToolResult>;

export interface ResourceDefinition {
  name: string;
  title?: string;
  /** A fixed URI, or a URI template with `{variable}` segments. */
  uriPattern: string;
  description?: string;
  mimeType?: string;
  _meta?: Record<string, unknown>;
}

export type ResourceHandler = (
  uri: string,
  context: HandlerContext,
) => ReadResourceResult | Promise<ReadResourceResult>;

export interface PromptDefinition {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export type PromptHandler = (
  name: string,
  args: Record<string, string> | undefined,
  context: HandlerContext,
) => GetPromptResult | Promise<GetPromptResult>;

export interface McpRegistryOptions {
  /** Protected resource URI; scope challenges are added only when set. */
  resourceUri?: string;
  /** MCP Apps sandbox configuration read by the UI resources. */
  mcpAppConfig?: McpAppResourceMetaOptions;
}

function contextOf(ctx: ServerContext): HandlerContext {
  const authInfo: AuthInfo | undefined = ctx.http?.authInfo;
  return authInfo ? { authInfo } : {};
}

export class McpRegistry {
  readonly mcpAppConfig?: McpAppResourceMetaOptions;
  readonly #resourceUri?: string;
  readonly #tools: Array<{ definition: ToolDefinition; handler: ToolHandler }> =
    [];
  readonly #resources: Array<{
    definition: ResourceDefinition;
    handler: ResourceHandler;
  }> = [];
  readonly #prompts: Array<{
    definition: PromptDefinition;
    argsSchema: TObject;
    handler: PromptHandler;
  }> = [];
  readonly #toolScopes = new Set<CredentialScope>();

  constructor(options: McpRegistryOptions = {}) {
    this.#resourceUri = options.resourceUri;
    this.mcpAppConfig = options.mcpAppConfig;
  }

  mcpAddTool<TInput extends TObject>(
    definition: ToolDefinition<TInput>,
    handler: ToolHandler<TInput>,
  ): void {
    // Fail at startup, not on the first call: every tool needs a reviewed
    // annotation policy and a securitySchemes declaration.
    annotationsForTool(definition.name);
    const schemes = securitySchemesOf(definition._meta);
    if (!schemes) {
      throw new Error(
        `MCP tool ${definition.name} must declare _meta.securitySchemes`,
      );
    }
    for (const scheme of schemes) {
      for (const scope of scheme.scopes) this.#toolScopes.add(scope);
    }
    this.#tools.push({
      definition: definition as unknown as ToolDefinition,
      handler: handler as unknown as ToolHandler,
    });
  }

  mcpAddResource(definition: ResourceDefinition, handler: ResourceHandler) {
    this.#resources.push({ definition, handler });
  }

  mcpAddPrompt(definition: PromptDefinition, handler: PromptHandler) {
    // Built once so the per-request servers share one compiled validator.
    const argsSchema = Type.Object(
      Object.fromEntries(
        (definition.arguments ?? []).map((arg) => {
          const field = Type.String(
            arg.description ? { description: arg.description } : {},
          );
          return [arg.name, arg.required ? field : Type.Optional(field)];
        }),
      ),
    );
    this.#prompts.push({ definition, argsSchema, handler });
  }

  /** Scopes declared across all registered tools. */
  get toolScopes(): ReadonlySet<CredentialScope> {
    return this.#toolScopes;
  }

  /** Build a server carrying every registered definition. */
  createServer(serverInfo: { name: string; version: string }): McpServer {
    const server = new McpServer(serverInfo, {
      capabilities: { tools: {}, resources: {}, prompts: {} },
    });
    for (const tool of this.#tools) this.#registerTool(server, tool);
    for (const resource of this.#resources) {
      this.#registerResource(server, resource);
    }
    for (const prompt of this.#prompts) this.#registerPrompt(server, prompt);
    return server;
  }

  #registerTool(
    server: McpServer,
    {
      definition,
      handler,
    }: { definition: ToolDefinition; handler: ToolHandler },
  ): void {
    const resourceUri = this.#resourceUri;
    const toolScopes = this.#toolScopes;
    const requiredScopes = (securitySchemesOf(definition._meta) ?? []).flatMap(
      (scheme) => scheme.scopes,
    );
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: typebox(definition.inputSchema),
        ...(definition.outputSchema
          ? { outputSchema: typebox(definition.outputSchema) }
          : {}),
        annotations: annotationsForTool(definition.name),
        _meta: definition._meta,
      },
      async (args: Record<string, unknown>, ctx: ServerContext) => {
        const context = contextOf(ctx);
        if (!resourceUri) return handler(args, context);

        // The declared scopes are the REST routes' requiredScopes, so a token
        // lacking one would be refused there anyway. Answer here instead,
        // with the challenge, and skip the round trip.
        const granted = new Set(context.authInfo?.scopes ?? []);
        const missing = requiredScopes.find((scope) => !granted.has(scope));
        const result = missing
          ? errorResult(`Missing required scope: ${missing}`)
          : await handler(args, context);
        // Also covers a scope the REST API demands beyond the declaration.
        return withScopeChallenge(result, resourceUri, toolScopes);
      },
    );
  }

  #registerResource(
    server: McpServer,
    {
      definition,
      handler,
    }: { definition: ResourceDefinition; handler: ResourceHandler },
  ): void {
    const metadata = {
      title: definition.title,
      description: definition.description,
      mimeType: definition.mimeType,
      _meta: definition._meta,
    };
    if (definition.uriPattern.includes('{')) {
      server.registerResource(
        definition.name,
        new ResourceTemplate(definition.uriPattern, { list: undefined }),
        metadata,
        (uri, _variables, ctx) => handler(uri.href, contextOf(ctx)),
      );
      return;
    }
    server.registerResource(
      definition.name,
      definition.uriPattern,
      metadata,
      (uri, ctx) => handler(uri.href, contextOf(ctx)),
    );
  }

  #registerPrompt(
    server: McpServer,
    {
      definition,
      argsSchema,
      handler,
    }: {
      definition: PromptDefinition;
      argsSchema: TObject;
      handler: PromptHandler;
    },
  ): void {
    server.registerPrompt(
      definition.name,
      { description: definition.description, argsSchema: typebox(argsSchema) },
      (promptArgs, ctx) =>
        handler(
          definition.name,
          promptArgs as Record<string, string>,
          contextOf(ctx),
        ),
    );
  }
}
