import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MCP_APP_RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';

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
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  prefersBorder?: boolean;
}

export function createMcpAppResourceMeta(
  options: McpAppResourceMetaOptions = {},
): {
  ui: {
    csp: {
      connectDomains: string[];
      resourceDomains: string[];
      frameDomains: string[];
    };
    prefersBorder: boolean;
  };
} {
  return {
    ui: {
      csp: {
        connectDomains: options.connectDomains ?? [],
        resourceDomains: options.resourceDomains ?? [],
        frameDomains: options.frameDomains ?? [],
      },
      prefersBorder: options.prefersBorder ?? false,
    },
  };
}

export function createMcpAppToolMeta(resourceUri: string): {
  ui: {
    resourceUri: string;
    visibility: ['model', 'app'];
  };
} {
  return {
    ui: {
      resourceUri,
      visibility: ['model', 'app'],
    },
  };
}
