import type { Client, ClientOptions, Config, RequestOptions } from './types.js';

const scalarString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  throw new Error('Generated request parameters must be scalar values');
};

const mergeHeaders = (
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const source of [left, right]) {
    for (const [name, value] of Object.entries(source ?? {})) {
      if (value !== undefined && value !== null) {
        result[name] = scalarString(value);
      }
    }
  }
  return result;
};

const addQuery = (url: string, query?: Record<string, unknown>): string => {
  const parts: string[] = [];
  for (const [name, raw] of Object.entries(query ?? {})) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value !== undefined && value !== null) {
        parts.push(
          `${encodeURIComponent(name)}=${encodeURIComponent(scalarString(value))}`,
        );
      }
    }
  }
  return parts.length ? `${url}?${parts.join('&')}` : url;
};

export const buildUrl: Client['buildUrl'] = (options) => {
  let path = options.url;
  for (const [name, value] of Object.entries(options.path ?? {})) {
    path = path.replace(`{${name}}`, encodeURIComponent(scalarString(value)));
  }
  const baseUrl = typeof options.baseUrl === 'string' ? options.baseUrl : '';
  return addQuery(`${baseUrl}${path}`, options.query);
};

export const createConfig = <_T = ClientOptions>(
  override: Config = {},
): Config => ({ responseStyle: 'fields', throwOnError: false, ...override });

export const createClient = (initial: Config = {}): Client => {
  let config = createConfig(initial);
  const request = async (options: RequestOptions) => {
    const resolved = { ...config, ...options };
    if (!resolved.transport) throw new Error('HTTP transport is required');
    const data = await resolved.transport({
      body: resolved.body,
      headers: mergeHeaders(config.headers, options.headers),
      method: resolved.method ?? 'GET',
      signal: resolved.signal as AbortSignal | undefined,
      url: buildUrl(resolved),
    });
    return resolved.responseStyle === 'data'
      ? data
      : { data, error: undefined };
  };
  const method = (name: string) => (options: RequestOptions) =>
    request({ ...options, method: name });
  return {
    buildUrl,
    connect: method('CONNECT'),
    delete: method('DELETE'),
    get: method('GET'),
    getConfig: () => ({ ...config }),
    head: method('HEAD'),
    options: method('OPTIONS'),
    patch: method('PATCH'),
    post: method('POST'),
    put: method('PUT'),
    request,
    setConfig: (next) => (config = { ...config, ...next }),
    trace: method('TRACE'),
  } as Client;
};
