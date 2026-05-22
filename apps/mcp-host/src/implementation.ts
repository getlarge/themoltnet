import {
  AppBridge,
  buildAllowAttribute,
  getToolUiResourceUri,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
  PostMessageTransport,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  CallToolResult,
  Resource,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

export interface ServerInfo {
  client: Client;
  name: string;
  resources: Map<string, Resource>;
  tools: Map<string, Tool>;
}

export interface UiResourceData {
  csp?: McpUiResourceCsp;
  html: string;
  permissions?: McpUiResourcePermissions;
}

export interface ToolCallInfo {
  appResourcePromise?: Promise<UiResourceData>;
  input: Record<string, unknown>;
  resultPromise: Promise<CallToolResult>;
  serverInfo: ServerInfo;
  tool: Tool;
}

export interface HostCallbacks {
  onAppReady?: () => void;
  onOpenLink?: (url: string) => void;
  onStatus?: (message: string) => void;
}

function hasMethod(
  value: unknown,
  method: string,
): value is { method: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    'method' in value &&
    (value as { method?: unknown }).method === method
  );
}

export async function connectToServer(
  serverUrl: string,
  authHeaders: Record<string, string>,
): Promise<ServerInfo> {
  const client = new Client({ name: 'MoltNet MCP Host E2E', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
    requestInit: {
      headers: authHeaders,
    },
  });

  await client.connect(transport);

  const [toolsList, resourcesList] = await Promise.all([
    client.listTools(),
    client.listResources(),
  ]);

  return {
    client,
    name: client.getServerVersion()?.name ?? serverUrl,
    resources: new Map(
      resourcesList.resources.map((resource) => [resource.uri, resource]),
    ),
    tools: new Map(toolsList.tools.map((tool) => [tool.name, tool])),
  };
}

export function callTool(
  serverInfo: ServerInfo,
  name: string,
  input: Record<string, unknown>,
): ToolCallInfo {
  const tool = serverInfo.tools.get(name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  const resultPromise = serverInfo.client.callTool({
    name,
    arguments: input,
  }) as Promise<CallToolResult>;

  const toolCallInfo: ToolCallInfo = {
    input,
    resultPromise,
    serverInfo,
    tool,
  };

  const uiResourceUri = getToolUiResourceUri(tool);
  if (uiResourceUri) {
    toolCallInfo.appResourcePromise = readUiResource(serverInfo, uiResourceUri);
  }

  return toolCallInfo;
}

async function readUiResource(
  serverInfo: ServerInfo,
  resourceUri: string,
): Promise<UiResourceData> {
  const result = await serverInfo.client.readResource({ uri: resourceUri });
  const content = result.contents[0];

  if (!content || content.mimeType !== RESOURCE_MIME_TYPE) {
    throw new Error(`Unsupported UI resource for ${resourceUri}`);
  }

  const listingMeta = serverInfo.resources.get(resourceUri)?._meta as
    | {
        ui?: { csp?: McpUiResourceCsp; permissions?: McpUiResourcePermissions };
      }
    | undefined;
  const contentMeta = (
    content as {
      _meta?: {
        ui?: { csp?: McpUiResourceCsp; permissions?: McpUiResourcePermissions };
      };
    }
  )._meta;
  const uiMeta = contentMeta?.ui ?? listingMeta?.ui;

  return {
    csp: uiMeta?.csp,
    html: 'blob' in content ? atob(content.blob) : (content.text ?? ''),
    permissions: uiMeta?.permissions,
  };
}

async function loadSandboxProxy(
  iframe: HTMLIFrameElement,
  sandboxBaseUrl: string,
  uiResource: UiResourceData,
): Promise<void> {
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
  const allow = buildAllowAttribute(uiResource.permissions);
  if (allow) {
    iframe.setAttribute('allow', allow);
  }

  const sandboxUrl = new URL(sandboxBaseUrl);
  if (uiResource.csp) {
    sandboxUrl.searchParams.set('csp', JSON.stringify(uiResource.csp));
  }

  const readyPromise = new Promise<void>((resolve) => {
    const listener = ({ data, source }: MessageEvent) => {
      if (
        source === iframe.contentWindow &&
        hasMethod(data, 'ui/notifications/sandbox-proxy-ready')
      ) {
        window.removeEventListener('message', listener);
        resolve();
      }
    };

    window.addEventListener('message', listener);
  });

  iframe.src = sandboxUrl.toString();
  await readyPromise;
}

function appInitializedPromise(appBridge: AppBridge): Promise<void> {
  return new Promise((resolve) => {
    appBridge.oninitialized = () => {
      resolve();
    };
  });
}

export async function mountToolUi(
  toolCallInfo: ToolCallInfo,
  iframe: HTMLIFrameElement,
  sandboxBaseUrl: string,
  callbacks: HostCallbacks = {},
): Promise<AppBridge | undefined> {
  if (!toolCallInfo.appResourcePromise || !iframe.contentWindow) {
    return undefined;
  }

  const uiResource = await toolCallInfo.appResourcePromise;
  await loadSandboxProxy(iframe, sandboxBaseUrl, uiResource);

  const appBridge = new AppBridge(
    toolCallInfo.serverInfo.client,
    { name: 'MoltNet MCP Host E2E', version: '0.1.0' },
    {
      logging: {},
      openLinks: {},
      serverResources:
        toolCallInfo.serverInfo.client.getServerCapabilities()?.resources,
      serverTools:
        toolCallInfo.serverInfo.client.getServerCapabilities()?.tools,
    },
    {
      hostContext: {
        availableDisplayModes: ['inline', 'fullscreen'],
        containerDimensions: { maxHeight: 6000 },
        displayMode: 'inline',
        platform: 'web',
        theme: 'light',
      },
    },
  );

  appBridge.onopenlink = (params: { url: string }) => {
    callbacks.onOpenLink?.(params.url);
    window.open(params.url, '_blank', 'noopener,noreferrer');
    return {};
  };

  appBridge.onsizechange = ({
    height,
    width,
  }: {
    height?: number;
    width?: number;
  }) => {
    if (width !== undefined) {
      iframe.style.width = `min(${Math.round(width)}px, 100%)`;
    }
    if (height !== undefined) {
      iframe.style.height = `${Math.round(height)}px`;
    }
  };

  const initialized = appInitializedPromise(appBridge);
  await appBridge.connect(
    new PostMessageTransport(iframe.contentWindow, iframe.contentWindow),
  );
  await appBridge.sendSandboxResourceReady(uiResource);
  await initialized;

  callbacks.onStatus?.('app-ready');
  callbacks.onAppReady?.();

  void appBridge.sendToolInput({ arguments: toolCallInfo.input });
  toolCallInfo.resultPromise.then(
    (result) => {
      void appBridge.sendToolResult(result);
    },
    (error: unknown) => {
      void appBridge.sendToolCancelled({
        reason: error instanceof Error ? error.message : String(error),
      });
    },
  );

  return appBridge;
}
