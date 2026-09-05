import { describe, expect, it } from 'vitest';

import {
  loadConfig,
  loadDatabaseConfig,
  loadDbosWorkflowRetentionConfig,
  loadObservabilityConfig,
  loadOryConfig,
  loadRecoveryConfig,
  loadSecurityConfig,
  loadServerConfig,
  loadTaskOrphanSweeperConfig,
  loadWebhookConfig,
  resolveOryUrls,
  resolveRedisConfig,
} from '../src/config.js';

const validEnv = {
  PORT: '8000',
  NODE_ENV: 'production',
  CORS_ORIGINS: 'https://themolt.net',
  DATABASE_URL: 'postgresql://localhost/moltnet',
  DBOS_SYSTEM_DATABASE_URL: 'postgresql://localhost/moltnet_dbos',
  ORY_ACTION_API_KEY: 'test-webhook-key',
  ORY_PROJECT_URL: 'https://ory.example.com',
  ORY_API_KEY: 'ory_pat_xxx',
  AXIOM_API_TOKEN: 'xaat-xxx',
  OTLP_ENDPOINT: 'https://api.axiom.co',
  AXIOM_DATASET: 'moltnet',
  AXIOM_LOGS_DATASET: 'moltnet-logs',
  AXIOM_TRACES_DATASET: 'moltnet-traces',
  AXIOM_METRICS_DATASET: 'moltnet-metrics',
  RECOVERY_CHALLENGE_SECRET: 'test-recovery-secret-at-least-16',
  // Required in production: rest-api runs more than one machine, so a
  // per-instance cache would break credential rotation (issue #1860).
  REDIS_URL: 'redis://localhost:6379',
};

// ============================================================================
// ServerConfig
// ============================================================================

describe('loadServerConfig', () => {
  it('parses valid config', () => {
    const config = loadServerConfig({ PORT: '3000', NODE_ENV: 'production' });
    expect(config).toEqual({
      PORT: 3000,
      NODE_ENV: 'production',
    });
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

describe('maintenance retention config', () => {
  it('applies the production containment defaults', () => {
    expect(loadDbosWorkflowRetentionConfig({})).toEqual({
      DBOS_WORKFLOW_RETENTION_ENABLED: true,
      DBOS_WORKFLOW_RETENTION_DAYS: 30,
      DBOS_WORKFLOW_RETENTION_BATCH_SIZE: 1000,
      DBOS_WORKFLOW_RETENTION_CRON: '15 * * * *',
    });
  });

  it('parses DBOS retention overrides', () => {
    expect(
      loadDbosWorkflowRetentionConfig({
        DBOS_WORKFLOW_RETENTION_ENABLED: 'false',
        DBOS_WORKFLOW_RETENTION_DAYS: '45',
        DBOS_WORKFLOW_RETENTION_BATCH_SIZE: '250',
        DBOS_WORKFLOW_RETENTION_CRON: '0 3 * * *',
      }),
    ).toEqual({
      DBOS_WORKFLOW_RETENTION_ENABLED: false,
      DBOS_WORKFLOW_RETENTION_DAYS: 45,
      DBOS_WORKFLOW_RETENTION_BATCH_SIZE: 250,
      DBOS_WORKFLOW_RETENTION_CRON: '0 3 * * *',
    });
  });

  it('keeps orphan recovery frequent while task expiry is hourly', () => {
    const config = loadTaskOrphanSweeperConfig({});

    expect(config.TASK_ORPHAN_SWEEPER_CRON).toBe('*/2 * * * *');
    expect(config.TASK_EXPIRY_SWEEPER_CRON).toBe('0 * * * *');
    expect(config.TASK_EXPIRY_SWEEPER_BATCH_SIZE).toBe(50);
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
      ORY_TALOS_ADMIN_URL: 'http://talos:4420',
    });
    expect(config.ORY_KRATOS_PUBLIC_URL).toBe('http://kratos:4433');
    expect(config.ORY_KETO_ADMIN_URL).toBe('http://keto:4467');
    expect(config.ORY_TALOS_ADMIN_URL).toBe('http://talos:4420');
  });

  it('allows all fields to be optional', () => {
    const config = loadOryConfig({});
    expect(config.ORY_PROJECT_URL).toBeUndefined();
    expect(config.ORY_API_KEY).toBeUndefined();
    expect(config.ORY_AUTH_CACHE_TTL_MS).toBe(60_000);
    expect(config.ORY_AUTH_CACHE_MAX_ENTRIES).toBe(10_000);
    expect(config.ORY_AUTH_REQUEST_TIMEOUT_MS).toBe(5_000);
  });

  it('accepts cache disable and bounded auth overrides', () => {
    const config = loadOryConfig({
      ORY_AUTH_CACHE_TTL_MS: '0',
      ORY_AUTH_CACHE_MAX_ENTRIES: '25',
      ORY_AUTH_REQUEST_TIMEOUT_MS: '2500',
    });

    expect(config.ORY_AUTH_CACHE_TTL_MS).toBe(0);
    expect(config.ORY_AUTH_CACHE_MAX_ENTRIES).toBe(25);
    expect(config.ORY_AUTH_REQUEST_TIMEOUT_MS).toBe(2_500);
  });

  it('rejects a malformed Talos admin URL', () => {
    expect(() =>
      loadOryConfig({ ORY_TALOS_ADMIN_URL: 'not-a-valid-url' }),
    ).toThrow('Invalid Ory config');
  });
});

// ============================================================================
// ObservabilityConfig
// ============================================================================

describe('loadObservabilityConfig', () => {
  it('parses valid config', () => {
    const config = loadObservabilityConfig({
      AXIOM_API_TOKEN: 'xaat-xxx',
      OTLP_ENDPOINT: 'https://api.axiom.co',
      AXIOM_DATASET: 'legacy',
      AXIOM_LOGS_DATASET: 'logs',
      AXIOM_TRACES_DATASET: 'traces',
      AXIOM_METRICS_DATASET: 'metrics',
    });
    expect(config.AXIOM_API_TOKEN).toBe('xaat-xxx');
    expect(config.AXIOM_DATASET).toBe('legacy');
    expect(config.AXIOM_LOGS_DATASET).toBe('logs');
    expect(config.AXIOM_TRACES_DATASET).toBe('traces');
    expect(config.AXIOM_METRICS_DATASET).toBe('metrics');
    expect(config.OTLP_ENDPOINT).toBe('https://api.axiom.co');
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
// SecurityConfig
// ============================================================================

describe('loadSecurityConfig', () => {
  it('defaults SIGNING_MAX_PENDING_REQUESTS to 10', () => {
    const config = loadSecurityConfig({});
    expect(config.SIGNING_MAX_PENDING_REQUESTS).toBe(10);
  });

  it('rejects a zero pending signing-request cap', () => {
    expect(() =>
      loadSecurityConfig({ SIGNING_MAX_PENDING_REQUESTS: '0' }),
    ).toThrowError(/Invalid Security config/);
  });

  it('defaults RATE_LIMIT_LEGREFFIER_START to 3', () => {
    const config = loadSecurityConfig({});
    expect(config.RATE_LIMIT_LEGREFFIER_START).toBe(3);
  });

  it('defaults API_BASE_URL to production URL', () => {
    const config = loadSecurityConfig({});
    expect(config.API_BASE_URL).toBe('https://api.themolt.net');
  });

  it('accepts custom API_BASE_URL', () => {
    const config = loadSecurityConfig({
      API_BASE_URL: 'http://localhost:8000',
    });
    expect(config.API_BASE_URL).toBe('http://localhost:8000');
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

  it('rejects a public plaintext Talos admin URL in production', () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        ORY_TALOS_ADMIN_URL: 'http://talos.example.com:4420',
      }),
    ).toThrow('Talos admin traffic must use HTTPS');
  });

  it('allows a plaintext internal Talos admin URL in production', () => {
    const config = loadConfig({
      ...validEnv,
      ORY_TALOS_ADMIN_URL: 'http://talos:4420',
    });

    expect(config.ory.ORY_TALOS_ADMIN_URL).toBe('http://talos:4420');
  });

  it('refuses to start in production without a shared Redis store', () => {
    // Arrange — rest-api runs more than one machine, so a per-instance grant
    // cache would let a rotated-away client secret keep working on whichever
    // instance did not handle the rotation (issue #1860).
    const { REDIS_URL: _omitted, ...withoutRedis } = validEnv;

    // Act + Assert
    expect(() => loadConfig(withoutRedis)).toThrow(
      'REDIS_URL or REDIS_HOST must be set in production',
    );
  });

  it('accepts REDIS_HOST as the shared store', () => {
    // Arrange
    const { REDIS_URL: _omitted, ...env } = validEnv;

    // Act
    const config = loadConfig({ ...env, REDIS_HOST: 'redis' });

    // Assert
    expect(config.security.REDIS_HOST).toBe('redis');
  });

  it('allows an in-memory store outside production', () => {
    // Arrange — dev and e2e run single-process, where per-instance is correct
    const { REDIS_URL: _omitted, ...env } = validEnv;

    // Act
    const config = loadConfig({ ...env, NODE_ENV: 'development' });

    // Assert
    expect(config.security.REDIS_URL).toBeUndefined();
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
      ORY_TALOS_ADMIN_URL: 'http://talos:4420',
      ORY_API_KEY: 'ory_pat_xxx',
    });
    expect(resolved.kratosPublicUrl).toBe('http://kratos:4433');
    expect(resolved.kratosAdminUrl).toBe('http://kratos:4434');
    expect(resolved.hydraPublicUrl).toBe('http://hydra:4444');
    expect(resolved.hydraAdminUrl).toBe('http://hydra:4445');
    expect(resolved.ketoPublicUrl).toBe('http://keto:4466');
    expect(resolved.ketoAdminUrl).toBe('http://keto:4467');
    expect(resolved.talosAdminUrl).toBe('http://talos:4420');
    expect(resolved.apiKey).toBe('ory_pat_xxx');
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
    expect(resolved.talosAdminUrl).toBe('https://ory.example.com');
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

  it('leaves Talos disabled for self-hosted Ory unless its URL is set', () => {
    const resolved = resolveOryUrls({
      ORY_KRATOS_PUBLIC_URL: 'http://kratos:4433',
      ORY_KRATOS_ADMIN_URL: 'http://kratos:4434',
      ORY_HYDRA_PUBLIC_URL: 'http://hydra:4444',
      ORY_HYDRA_ADMIN_URL: 'http://hydra:4445',
      ORY_KETO_PUBLIC_URL: 'http://keto:4466',
      ORY_KETO_ADMIN_URL: 'http://keto:4467',
    });

    expect(resolved.talosAdminUrl).toBeUndefined();
  });
});

describe('resolveRedisConfig', () => {
  it('returns null when neither REDIS_URL nor REDIS_HOST is set', () => {
    expect(resolveRedisConfig({})).toBeNull();
  });

  it('resolves discrete host/port/password/db config', () => {
    expect(
      resolveRedisConfig({
        REDIS_HOST: 'redis.internal',
        REDIS_PORT: 6380,
        REDIS_PASSWORD: 'secret',
        REDIS_DB: 4,
      }),
    ).toEqual({
      host: 'redis.internal',
      port: 6380,
      password: 'secret',
      db: 4,
      tls: undefined,
    });
  });

  it('defaults the port to 6379 when only host is given', () => {
    expect(resolveRedisConfig({ REDIS_HOST: 'redis' })).toMatchObject({
      host: 'redis',
      port: 6379,
    });
  });

  it('enables TLS for host config when REDIS_TLS is true', () => {
    expect(
      resolveRedisConfig({ REDIS_HOST: 'redis', REDIS_TLS: true }),
    ).toMatchObject({ tls: {} });
  });

  it('parses a redis:// URL into host/port/db', () => {
    expect(
      resolveRedisConfig({ REDIS_URL: 'redis://cache.internal:6380/3' }),
    ).toEqual({
      host: 'cache.internal',
      port: 6380,
      password: undefined,
      db: 3,
      tls: undefined,
    });
  });

  it('treats a rediss:// URL as TLS-enabled', () => {
    expect(
      resolveRedisConfig({ REDIS_URL: 'rediss://:pw@cache.internal/7' }),
    ).toMatchObject({
      host: 'cache.internal',
      port: 6379,
      password: 'pw',
      db: 7,
      tls: {},
    });
  });

  it('lets discrete REDIS_PASSWORD/DB override URL-embedded values', () => {
    expect(
      resolveRedisConfig({
        REDIS_URL: 'redis://:urlpw@cache.internal/1',
        REDIS_PASSWORD: 'override',
        REDIS_DB: 9,
      }),
    ).toMatchObject({ password: 'override', db: 9 });
  });

  it('throws on a non-redis URL scheme', () => {
    expect(() =>
      resolveRedisConfig({ REDIS_URL: 'http://nope.example.com' }),
    ).toThrow(/redis:\/\/ or rediss:\/\//);
  });
});
