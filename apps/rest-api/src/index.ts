/**
 * @moltnet/rest-api — Entry Point
 */

export { type AppOptions, buildApp, registerApiRoutes } from './app.js';
export type {
  AppConfig,
  DatabaseConfig,
  ObservabilityEnvConfig,
  OryConfig,
  RecoveryConfig,
  ResolvedOryUrls,
  SecurityConfig,
  ServerConfig,
  WebhookConfig,
} from './config.js';
export {
  loadConfig,
  loadDatabaseConfig,
  loadObservabilityConfig,
  loadOryConfig,
  loadRecoveryConfig,
  loadSecurityConfig,
  loadServerConfig,
  loadWebhookConfig,
  resolveOryUrls,
} from './config.js';
export {
  default as dbosPlugin,
  type DBOSPluginOptions,
} from './plugins/dbos.js';
