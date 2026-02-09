import { describe, expect, it } from 'vitest';

import {
  loadConfig,
  loadDatabaseConfig,
  loadObservabilityConfig,
  loadOryConfig,
  loadRecoveryConfig,
  loadServerConfig,
  loadWebhookConfig,
  resolveOryUrls,
} from '../src/config.js';

const validEnv = {
  PORT: '8000',
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://localhost/moltnet',
  DBOS_SYSTEM_DATABASE_URL: 'postgresql://localhost/moltnet_dbos',
  ORY_ACTION_API_KEY: 'test-webhook-key',
  ORY_PROJECT_URL: 'https://ory.example.com',
  ORY_API_KEY: 'ory_pat_xxx',
  AXIOM_API_TOKEN: 'xaat-xxx',
  AXIOM_LOGS_DATASET: 'moltnet-logs',
  AXIOM_TRACES_DATASET: 'moltnet-traces',
  AXIOM_METRICS_DATASET: 'moltnet-metrics',
  RECOVERY_CHALLENGE_SECRET: 'test-recovery-secret-at-least-16',
};

// ============================================================================
// ServerConfig
// ============================================================================

describe('loadServerConfig', () => {
  it('parses valid config', () => {
    const config = loadServerConfig({ PORT: '3000', NODE_ENV: 'production' });
    expect(config).toEqual({ PORT: 3000, NODE_ENV: 'production' });
  });

  it('coerces string PORT to number', () => {
    const config = loadServerConfig({ PORT: '8080', NODE_ENV: 'test' });
    expect(config.PORT).toBe(8080);
    expect(typeof config.PORT).toBe('number');
  });

  it('applies defaults when env is empty', () => {
    const config = loadServerConfig({});
    expect(config.PORT).toBe(8000);
    expect(config.NODE_ENV).toBe('development');
  });

  it('rejects invalid NODE_ENV', () => {
    expect(() => loadServerConfig({ NODE_ENV: 'invalid' })).toThrow(
      'Invalid Server config',
    );
  });
});

// ============================================================================
// DatabaseConfig
// ============================================================================

describe('loadDatabaseConfig', () => {
  it('parses valid config', () => {
    const config = loadDatabaseConfig({
      DATABASE_URL: 'postgresql://localhost/moltnet',
      DBOS_SYSTEM_DATABASE_URL: 'postgresql://localhost/moltnet_dbos',
    });
    expect(config.DATABASE_URL).toBe('postgresql://localhost/moltnet');
    expect(config.DBOS_SYSTEM_DATABASE_URL).toBe(
      'postgresql://localhost/moltnet_dbos',
    );
  });

  it('allows missing DATABASE_URL (optional)', () => {
    const config = loadDatabaseConfig({
      DBOS_SYSTEM_DATABASE_URL: 'postgresql://localhost/moltnet_dbos',
    });
    expect(config.DATABASE_URL).toBeUndefined();
  });

  it('throws when DBOS_SYSTEM_DATABASE_URL is missing', () => {
    expect(() => loadDatabaseConfig({})).toThrow('Invalid Database config');
  });
});

// ============================================================================
// WebhookConfig
// ============================================================================

describe('loadWebhookConfig', () => {
  it('parses valid config', () => {
    const config = loadWebhookConfig({
      ORY_ACTION_API_KEY: 'my-secret-key',
    });
    expect(config.ORY_ACTION_API_KEY).toBe('my-secret-key');
  });

  it('throws when ORY_ACTION_API_KEY is missing', () => {
    expect(() => loadWebhookConfig({})).toThrow('Invalid Webhook config');
  });

  it('throws when ORY_ACTION_API_KEY is empty string', () => {
    expect(() => loadWebhookConfig({ ORY_ACTION_API_KEY: '' })).toThrow(
      'Invalid Webhook config',
    );
  });
});

// ============================================================================
// OryConfig
// ============================================================================

describe('loadOryConfig', () => {
  it('parses full Ory Network config', () => {
    const config = loadOryConfig({
      ORY_PROJECT_URL: 'https://ory.example.com',
      ORY_API_KEY: 'ory_pat_xxx',
    });
    expect(config.ORY_PROJECT_URL).toBe('https://ory.example.com');
    expect(config.ORY_API_KEY).toBe('ory_pat_xxx');
  });

  it('parses self-hosted per-service URLs', () => {
    const config = loadOryConfig({
      ORY_KRATOS_PUBLIC_URL: 'http://kratos:4433',
      ORY_KRATOS_ADMIN_URL: 'http://kratos:4434',
      ORY_HYDRA_PUBLIC_URL: 'http://hydra:4444',
      ORY_HYDRA_ADMIN_URL: 'http://hydra:4445',
      ORY_KETO_PUBLIC_URL: 'http://keto:4466',
      ORY_KETO_ADMIN_URL: 'http://keto:4467',
    });
    expect(config.ORY_KRATOS_PUBLIC_URL).toBe('http://kratos:4433');
    expect(config.ORY_KETO_ADMIN_URL).toBe('http://keto:4467');
  });

  it('allows all fields to be optional', () => {
    const config = loadOryConfig({});
    expect(config.ORY_PROJECT_URL).toBeUndefined();
    expect(config.ORY_API_KEY).toBeUndefined();
  });
});

// ============================================================================
// ObservabilityConfig
// ============================================================================

describe('loadObservabilityConfig', () => {
  it('parses valid config', () => {
    const config = loadObservabilityConfig({
      AXIOM_API_TOKEN: 'xaat-xxx',
      AXIOM_LOGS_DATASET: 'logs',
      AXIOM_TRACES_DATASET: 'traces',
      AXIOM_METRICS_DATASET: 'metrics',
    });
    expect(config.AXIOM_API_TOKEN).toBe('xaat-xxx');
    expect(config.AXIOM_LOGS_DATASET).toBe('logs');
  });

  it('allows all fields to be optional', () => {
    const config = loadObservabilityConfig({});
    expect(config.AXIOM_API_TOKEN).toBeUndefined();
  });
});

// ============================================================================
// RecoveryConfig
// ============================================================================

describe('loadRecoveryConfig', () => {
  it('parses valid config', () => {
    const config = loadRecoveryConfig({
      RECOVERY_CHALLENGE_SECRET: 'a-secret-at-least-16-chars',
    });
    expect(config.RECOVERY_CHALLENGE_SECRET).toBe('a-secret-at-least-16-chars');
  });

  it('throws when RECOVERY_CHALLENGE_SECRET is missing', () => {
    expect(() => loadRecoveryConfig({})).toThrow('Invalid Recovery config');
  });

  it('throws when RECOVERY_CHALLENGE_SECRET is too short', () => {
    expect(() =>
      loadRecoveryConfig({ RECOVERY_CHALLENGE_SECRET: 'short' }),
    ).toThrow('Invalid Recovery config');
  });
});

// ============================================================================
// loadConfig (combined)
// ============================================================================

describe('loadConfig', () => {
  it('returns all slices', () => {
    const config = loadConfig(validEnv);
    expect(config.server.PORT).toBe(8000);
    expect(config.server.NODE_ENV).toBe('production');
    expect(config.database.DATABASE_URL).toBe('postgresql://localhost/moltnet');
    expect(config.webhook.ORY_ACTION_API_KEY).toBe('test-webhook-key');
    expect(config.ory.ORY_PROJECT_URL).toBe('https://ory.example.com');
    expect(config.observability.AXIOM_API_TOKEN).toBe('xaat-xxx');
    expect(config.recovery.RECOVERY_CHALLENGE_SECRET).toBe(
      'test-recovery-secret-at-least-16',
    );
  });

  it('throws when a required field is missing', () => {
    const { ORY_ACTION_API_KEY: _, ...envWithoutKey } = validEnv;
    expect(() => loadConfig(envWithoutKey)).toThrow('Invalid Webhook config');
  });
});

// ============================================================================
// Cross-leak prevention
// ============================================================================

describe('cross-leak prevention', () => {
  it('server config does not contain database fields', () => {
    const config = loadServerConfig(validEnv);
    expect(config).not.toHaveProperty('DATABASE_URL');
    expect(config).not.toHaveProperty('ORY_ACTION_API_KEY');
  });

  it('webhook config does not contain database fields', () => {
    const config = loadWebhookConfig(validEnv);
    expect(config).not.toHaveProperty('DATABASE_URL');
    expect(config).not.toHaveProperty('PORT');
  });

  it('database config does not contain webhook fields', () => {
    const config = loadDatabaseConfig(validEnv);
    expect(config).not.toHaveProperty('ORY_ACTION_API_KEY');
    expect(config).not.toHaveProperty('PORT');
  });
});

// ============================================================================
// resolveOryUrls
// ============================================================================

describe('resolveOryUrls', () => {
  it('uses individual URLs when set', () => {
    const resolved = resolveOryUrls({
      ORY_PROJECT_URL: 'https://ory.example.com',
      ORY_KRATOS_PUBLIC_URL: 'http://kratos:4433',
      ORY_KRATOS_ADMIN_URL: 'http://kratos:4434',
      ORY_HYDRA_PUBLIC_URL: 'http://hydra:4444',
      ORY_HYDRA_ADMIN_URL: 'http://hydra:4445',
      ORY_KETO_PUBLIC_URL: 'http://keto:4466',
      ORY_KETO_ADMIN_URL: 'http://keto:4467',
    });
    expect(resolved.kratosPublicUrl).toBe('http://kratos:4433');
    expect(resolved.kratosAdminUrl).toBe('http://kratos:4434');
    expect(resolved.hydraPublicUrl).toBe('http://hydra:4444');
    expect(resolved.hydraAdminUrl).toBe('http://hydra:4445');
    expect(resolved.ketoPublicUrl).toBe('http://keto:4466');
    expect(resolved.ketoAdminUrl).toBe('http://keto:4467');
  });

  it('falls back to ORY_PROJECT_URL when individual URLs are missing', () => {
    const resolved = resolveOryUrls({
      ORY_PROJECT_URL: 'https://ory.example.com',
      ORY_API_KEY: 'ory_pat_xxx',
    });
    expect(resolved.kratosPublicUrl).toBe('https://ory.example.com');
    expect(resolved.kratosAdminUrl).toBe('https://ory.example.com');
    expect(resolved.hydraPublicUrl).toBe('https://ory.example.com');
    expect(resolved.hydraAdminUrl).toBe('https://ory.example.com');
    expect(resolved.ketoPublicUrl).toBe('https://ory.example.com');
    expect(resolved.ketoAdminUrl).toBe('https://ory.example.com');
    expect(resolved.apiKey).toBe('ory_pat_xxx');
  });

  it('individual URLs take precedence over ORY_PROJECT_URL', () => {
    const resolved = resolveOryUrls({
      ORY_PROJECT_URL: 'https://ory.example.com',
      ORY_KRATOS_PUBLIC_URL: 'http://kratos-custom:4433',
    });
    expect(resolved.kratosPublicUrl).toBe('http://kratos-custom:4433');
    expect(resolved.kratosAdminUrl).toBe('https://ory.example.com');
  });

  it('throws when neither individual URL nor ORY_PROJECT_URL is set', () => {
    expect(() => resolveOryUrls({})).toThrow(
      'Cannot resolve Kratos public URL',
    );
  });

  it('passes through apiKey as undefined when not set', () => {
    const resolved = resolveOryUrls({
      ORY_PROJECT_URL: 'https://ory.example.com',
    });
    expect(resolved.apiKey).toBeUndefined();
  });
});
