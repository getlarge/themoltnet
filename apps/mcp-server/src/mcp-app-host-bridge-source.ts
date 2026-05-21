declare const APP_NAME: string;
declare const APP_VERSION: string;

interface PendingRequest {
  resolve(result: unknown): void;
  reject(error: Error): void;
}

interface HostBridge {
  ontoolinput?: (params: unknown) => void;
  ontoolresult?: (params: unknown) => void;
  onerror?: (error: Error) => void;
  connect(): Promise<void>;
  callServerTool(params: unknown): Promise<unknown>;
  openLink(params: unknown): Promise<unknown>;
}

/**
 * Minimal MCP Apps bridge for sandboxed iframes.
 *
 * This function is serialized with `toString()` into the returned HTML.
 * It must not depend on module imports or closure state. Configuration is
 * injected via globals declared next to the serialized function source.
 */
function createHostBridge() {
  let nextId = 1;
  const pending = new Map<number, PendingRequest>();

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  function isJsonRpcEnvelope(
    value: unknown,
  ): value is Record<string, unknown> & { jsonrpc: '2.0' } {
    return isRecord(value) && value.jsonrpc === '2.0';
  }

  function isJsonRpcResponse(value: unknown): value is
    | (Record<string, unknown> & {
        jsonrpc: '2.0';
        id: number;
        result?: unknown;
      })
    | (Record<string, unknown> & {
        jsonrpc: '2.0';
        id: number;
        error: Record<string, unknown>;
      }) {
    return isJsonRpcEnvelope(value) && typeof value.id === 'number';
  }

  function isToolNotification(
    value: unknown,
    method: 'ui/notifications/tool-input' | 'ui/notifications/tool-result',
  ): value is Record<string, unknown> & {
    jsonrpc: '2.0';
    method: typeof method;
    params?: unknown;
  } {
    return isJsonRpcEnvelope(value) && value.method === method;
  }

  const bridge: HostBridge = {
    ontoolinput: undefined,
    ontoolresult: undefined,
    onerror: undefined,

    /** Initialize the app-side bridge with the parent host. */
    async connect() {
      window.addEventListener('message', (event) => {
        const message: unknown = event.data;

        if (isJsonRpcResponse(message)) {
          const handler = pending.get(message.id);
          if (!handler) return;
          pending.delete(message.id);

          if ('error' in message && isRecord(message.error)) {
            const error = new Error(
              typeof message.error.message === 'string'
                ? message.error.message
                : 'Host request failed',
            );
            bridge.onerror?.(error);
            handler.reject(error);
          } else {
            handler.resolve(message.result);
          }
          return;
        }

        if (isToolNotification(message, 'ui/notifications/tool-input')) {
          bridge.ontoolinput?.(message.params ?? {});
        } else if (
          isToolNotification(message, 'ui/notifications/tool-result')
        ) {
          bridge.ontoolresult?.(message.params ?? {});
        }
      });

      await request('ui/initialize', {
        appCapabilities: {},
        appInfo: { name: APP_NAME, version: APP_VERSION },
        protocolVersion: '2026-01-26',
      });

      notify('ui/notifications/initialized', {});
      notifySizeChanged();
    },

    /** Ask the host to call an MCP tool on the connected server. */
    callServerTool(params: unknown) {
      return request('tools/call', params);
    },

    /** Ask the host to open a normal external link. */
    openLink(params: unknown) {
      return request('ui/open-link', params);
    },
  };

  function request(method: string, params: unknown): Promise<unknown> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });
  }

  function notify(method: string, params: unknown): void {
    window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
  }

  function notifySizeChanged() {
    notify('ui/notifications/size-changed', {
      height: Math.ceil(document.documentElement.scrollHeight),
      width: Math.ceil(document.documentElement.scrollWidth),
    });
  }

  const resizeObserver = new ResizeObserver(() => notifySizeChanged());
  resizeObserver.observe(document.documentElement);
  resizeObserver.observe(document.body);

  return bridge;
}

/**
 * Build the browser-side MCP Apps host bridge script.
 *
 * This stays as source in the server app rather than as a loose asset so we do
 * not need an additional copy/bundle pipeline for v0 MCP apps.
 */
export function buildMcpAppHostBridgeScript(options: {
  appName: string;
  appVersion?: string;
}): string {
  return `
const APP_NAME = ${JSON.stringify(options.appName)};
const APP_VERSION = ${JSON.stringify(options.appVersion ?? '0.1.0')};
${createHostBridge.toString()}
`;
}
