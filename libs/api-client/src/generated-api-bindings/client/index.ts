export { buildUrl, createClient, createConfig } from './client.js';
export type {
  ApiRequest,
  Auth,
  Client,
  ClientMeta,
  ClientOptions,
  Config,
  CreateClientConfig,
  Options,
  QuerySerializerOptions,
  RequestExecutor,
  RequestOptions,
  RequestResult,
  ResponseStyle,
  TDataShape,
} from './types.js';

export const jsonBodySerializer = (body: unknown) => body;
export const formDataBodySerializer = (body: unknown) => body;
export const urlSearchParamsBodySerializer = (body: unknown) => body;
