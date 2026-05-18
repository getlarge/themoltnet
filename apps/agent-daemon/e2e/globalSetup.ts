/**
 * Daemon E2E Global Setup — Health Check Only.
 *
 * Mirrors apps/mcp-server/e2e/globalSetup.ts. The Docker Compose stack is
 * brought up by CI (or the developer) before the suite runs; we only
 * verify health here.
 *
 * Daemon e2e runs after the rest-api suite which has already restarted
 * the rest-api container with SPONSOR_AGENT_ID. We don't restart it
 * again — that would race other suites running against the same stack.
 */

async function waitForHealthy(url: string, maxAttempts = 60): Promise<void> {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // service not ready yet
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 2_000);
    });
  }
  throw new Error(
    `Service at ${url} did not become healthy after ${maxAttempts} attempts`,
  );
}

const E2E_LOCAL_DEFAULTS = {
  REST_API_URL: 'http://127.0.0.1:8080',
  DATABASE_URL: 'postgresql://moltnet:moltnet_secret@127.0.0.1:5433/moltnet',
  HYDRA_PUBLIC_URL: 'http://127.0.0.1:4444',
  ORY_HYDRA_ADMIN_URL: 'http://127.0.0.1:4445',
  ORY_KETO_PUBLIC_URL: 'http://127.0.0.1:4466',
  ORY_KETO_ADMIN_URL: 'http://127.0.0.1:4467',
  ORY_KRATOS_PUBLIC_URL: 'http://127.0.0.1:4433',
  ORY_KRATOS_ADMIN_URL: 'http://127.0.0.1:4434',
} as const;

function applyLocalFallbackEnv(): void {
  for (const [name, value] of Object.entries(E2E_LOCAL_DEFAULTS)) {
    if (!process.env[name]) {
      process.env[name] = value;
    }
  }
}

export default async function setup() {
  applyLocalFallbackEnv();
  // eslint-disable-next-line no-console
  console.log('[Daemon E2E] Waiting for services to be healthy...');
  await Promise.all([
    waitForHealthy(`${process.env.ORY_KRATOS_PUBLIC_URL}/health/alive`),
    waitForHealthy(`${process.env.HYDRA_PUBLIC_URL}/health/alive`),
    waitForHealthy(`${process.env.ORY_KETO_PUBLIC_URL}/health/alive`),
    waitForHealthy(`${process.env.REST_API_URL}/health`),
  ]);
  // eslint-disable-next-line no-console
  console.log('[Daemon E2E] All services ready');
}
