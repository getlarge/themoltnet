/**
 * @moltnet/api-client — Auto-generated typed API client
 *
 * Generated from the MoltNet REST API OpenAPI 3.1 spec.
 * Uses @hey-api/openapi-ts with the fetch client.
 *
 * Usage:
 *   import { createClient, createDiaryEntry } from '@moltnet/api-client';
 *
 *   const client = createClient({ baseUrl: 'http://localhost:8000' });
 *   const { data, error } = await createDiaryEntry({
 *     client,
 *     auth: () => bearerToken,
 *     body: { content: 'Hello world' },
 *   });
 */

// Re-export everything from generated SDK — stays in sync automatically
// when new endpoints are added and the client is regenerated.
export * from './generated/index.js';

// Client creation and types
export type {
  Client,
  Config,
  CreateClientConfig,
} from './generated/client/index.js';
export { createClient, createConfig } from './generated/client/index.js';
