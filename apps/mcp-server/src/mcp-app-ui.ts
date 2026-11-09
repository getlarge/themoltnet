import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Types only: the runtime package would pull its React peers into the image.
import type {
  McpUiResourceMeta,
  McpUiToolMeta,
} from '@modelcontextprotocol/ext-apps';
import type {
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
} from '@modelcontextprotocol/ext-apps/server';

/** ext-apps' `RESOURCE_MIME_TYPE`. */
export const MCP_APP_RESOURCE_MIME_TYPE: typeof RESOURCE_MIME_TYPE =
  'text/html;profile=mcp-app';
/** ext-apps' `RESOURCE_URI_META_KEY`: the flat key older hosts read. */
const LEGACY_RESOURCE_URI_KEY: typeof RESOURCE_URI_META_KEY = 'ui/resourceUri';

export function resolveInstalledMcpAppHtmlPath(
  packageName: string,
  importMetaUrl: string,
): string {
  let currentDir = path.dirname(fileURLToPath(importMetaUrl));

  while (true) {
    const candidatePath = path.join(
      currentDir,
      'node_modules',
      packageName,
      'dist',
      'index.html',
    );

    if (existsSync(candidatePath)) {
      return candidatePath;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(
        `Built MCP app artifact not found for ${packageName}. Run its build before starting @moltnet/mcp-server.`,
      );
    }
    currentDir = parentDir;
  }
}

export interface McpAppResourceMetaOptions {
  domain?: string;
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  prefersBorder?: boolean;
}

export function createMcpAppResourceMeta(
  options: McpAppResourceMetaOptions = {},
): { ui: McpUiResourceMeta } {
  return {
    ui: {
      ...(options.domain ? { domain: options.domain } : {}),
      csp: {
        connectDomains: options.connectDomains ?? [],
        resourceDomains: options.resourceDomains ?? [],
        frameDomains: options.frameDomains ?? [],
      },
      prefersBorder: options.prefersBorder ?? false,
    },
  };
}

/**
 * Tool metadata linking a tool to its MCP App. Older hosts read the flat
 * `ui/resourceUri` key; it carries the same URI, as ext-apps' `registerAppTool`
 * does.
 */
export function createMcpAppToolMeta(resourceUri: string): {
  ui: McpUiToolMeta;
  [LEGACY_RESOURCE_URI_KEY]: string;
} {
  return {
    ui: {
      resourceUri,
      visibility: ['model', 'app'],
    },
    [LEGACY_RESOURCE_URI_KEY]: resourceUri,
  };
}
