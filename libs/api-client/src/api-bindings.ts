/**
 * Generated MoltNet endpoint bindings using a caller-provided request executor.
 *
 * Hosts with their own networking and authentication layer, such as n8n, can
 * provide it here without pulling the Fetch client into their runtime bundle.
 */
export type {
  ApiRequest,
  Client,
  Config,
  CreateClientConfig,
  RequestExecutor,
} from './generated-api-bindings/client/index.js';
export {
  createClient,
  createConfig,
} from './generated-api-bindings/client/index.js';
export * from './generated-api-bindings/index.js';
