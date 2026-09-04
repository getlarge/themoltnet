/**
 * Full generated MoltNet API surface using a caller-provided HTTP transport.
 *
 * Hosts with their own networking and authentication layer, such as n8n, can
 * inject it here without pulling the Fetch client into their runtime bundle.
 */
export type {
  Client,
  Config,
  CreateClientConfig,
  Transport,
  TransportRequest,
} from './generated-transport/client/index.js';
export {
  createClient,
  createConfig,
} from './generated-transport/client/index.js';
export * from './generated-transport/index.js';
