export { buildUrl, createClient, createConfig } from './client.js';
export type {
  Auth,
  Client,
  ClientMeta,
  ClientOptions,
  Config,
  CreateClientConfig,
  Options,
  QuerySerializerOptions,
  RequestOptions,
  RequestResult,
  ResponseStyle,
  TDataShape,
  Transport,
  TransportRequest,
} from './types.js';

export const jsonBodySerializer = (body: unknown) => body;
export const formDataBodySerializer = (body: unknown) => body;
export const urlSearchParamsBodySerializer = (body: unknown) => body;
