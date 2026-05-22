export interface RuntimeConfigShape {
  autorun?: unknown;
  clientId?: unknown;
  clientSecret?: unknown;
  defaultArgs?: unknown;
  defaultTool?: unknown;
  sandboxBaseUrl?: unknown;
  servers?: unknown;
}

export interface HostConfig {
  autorun: boolean;
  clientId?: string;
  clientSecret?: string;
  defaultArgs: Record<string, unknown>;
  defaultTool: string;
  sandboxBaseUrl: string;
  servers: string[];
}

declare global {
  interface Window {
    __MCP_HOST_E2E_CONFIG__?: RuntimeConfigShape;
  }
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function stringArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const text = stringValue(entry);
      return text ? [text] : [];
    });
  }

  const text = stringValue(value);
  return text ? [text] : [];
}

function queryRecord(
  searchParams: URLSearchParams,
  key: string,
): Record<string, unknown> {
  const value = searchParams.get(key);
  if (!value) return {};

  try {
    return recordValue(JSON.parse(value));
  } catch {
    return {};
  }
}

export function readHostConfig(
  location: Location = window.location,
  runtimeConfig: RuntimeConfigShape = window.__MCP_HOST_E2E_CONFIG__ ?? {},
): HostConfig {
  const searchParams = new URLSearchParams(location.search);
  const queryArgs = queryRecord(searchParams, 'args');
  const queryClientId = stringValue(searchParams.get('clientId'));
  const queryClientSecret = stringValue(searchParams.get('clientSecret'));
  const queryServer = stringValue(searchParams.get('server'));
  const queryTool = stringValue(searchParams.get('tool'));
  const queryAutorun = booleanValue(searchParams.get('autorun'));
  const sandboxBaseUrl =
    stringValue(runtimeConfig.sandboxBaseUrl) ??
    `${location.protocol}//${location.hostname}:8081/sandbox.html`;

  return {
    autorun: queryAutorun ?? booleanValue(runtimeConfig.autorun) ?? false,
    clientId: queryClientId ?? stringValue(runtimeConfig.clientId),
    clientSecret: queryClientSecret ?? stringValue(runtimeConfig.clientSecret),
    defaultArgs:
      Object.keys(queryArgs).length > 0
        ? queryArgs
        : recordValue(runtimeConfig.defaultArgs),
    defaultTool:
      queryTool ?? stringValue(runtimeConfig.defaultTool) ?? 'tasks_app_open',
    sandboxBaseUrl,
    servers: queryServer
      ? [queryServer]
      : stringArrayValue(runtimeConfig.servers),
  };
}
