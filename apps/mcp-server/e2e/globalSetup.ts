/**
 * E2E Global Setup — Health Check Only
 *
 * Assumes Docker Compose is already running (started by CI or the developer).
 * Verifies all services are healthy before tests run.
 *
 * To start the stack locally:
 *   docker compose -f docker-compose.e2e.yaml up -d --build
 *
 * To start in CI (pre-built images):
 *   docker compose -f docker-compose.e2e.yaml -f docker-compose.e2e.ci.yaml up -d
 */

async function waitForHealthy(url: string, maxAttempts = 60): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Service not ready yet
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 2000);
    });
  }
  throw new Error(
    `Service at ${url} did not become healthy after ${maxAttempts} attempts`,
  );
}

const E2E_LOCAL_DEFAULTS = {
  MCP_SERVER_URL: 'http://127.0.0.1:8001',
  REST_API_URL: 'http://127.0.0.1:8080',
  DATABASE_URL: 'postgresql://moltnet:moltnet_secret@127.0.0.1:5433/moltnet',
  ORY_HYDRA_PUBLIC_URL: 'http://127.0.0.1:4444',
  ORY_HYDRA_ADMIN_URL: 'http://127.0.0.1:4445',
  ORY_KETO_PUBLIC_URL: 'http://127.0.0.1:4466',
  ORY_KETO_ADMIN_URL: 'http://127.0.0.1:4467',
  ORY_KRATOS_PUBLIC_URL: 'http://127.0.0.1:4433',
  ORY_KRATOS_ADMIN_URL: 'http://127.0.0.1:4434',
} as const;

function applyLocalFallbackEnv(): void {
  for (const [name, value] of Object.entries(E2E_LOCAL_DEFAULTS)) {
    process.env[name] = value;
  }
}

export default async function setup() {
  applyLocalFallbackEnv();
  // eslint-disable-next-line no-console
  console.log('[MCP E2E Setup] Waiting for services to be healthy...');

  await Promise.all([
    waitForHealthy(`${process.env.ORY_KRATOS_PUBLIC_URL}/health/alive`),
    waitForHealthy(`${process.env.ORY_HYDRA_PUBLIC_URL}/health/alive`),
    waitForHealthy(`${process.env.ORY_KETO_PUBLIC_URL}/health/alive`),
    waitForHealthy(`${process.env.REST_API_URL}/health`),
    waitForHealthy(`${process.env.MCP_SERVER_URL}/healthz`),
  ]);

  // eslint-disable-next-line no-console
  console.log('[MCP E2E Setup] All services ready');
}
