/**
 * Parallel Brief Runner E2E Global Setup — Health Check Only.
 *
 * Mirrors apps/agent-daemon-e2e/src/globalSetup.ts. The Docker Compose stack is
 * brought up by CI (or the developer, via `pnpm run e2e:up`) before the suite
 * runs; we only verify health here. The suite bootstraps its own agent through
 * @moltnet/bootstrap and does not require the rest-api SPONSOR_AGENT_ID restart.
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
  REST_API_URL: 'http://localhost:8080',
  DATABASE_URL: 'postgresql://moltnet:moltnet_secret@localhost:5433/moltnet',
  ORY_HYDRA_PUBLIC_URL: 'http://localhost:4444',
  ORY_HYDRA_ADMIN_URL: 'http://localhost:4445',
  ORY_KETO_PUBLIC_URL: 'http://localhost:4466',
  ORY_KETO_ADMIN_URL: 'http://localhost:4467',
  ORY_KRATOS_PUBLIC_URL: 'http://localhost:4433',
  ORY_KRATOS_ADMIN_URL: 'http://localhost:4434',
} as const;

function applyLocalFallbackEnv(): void {
  for (const [name, value] of Object.entries(E2E_LOCAL_DEFAULTS)) {
    process.env[name] ??= value;
  }
}

export default async function setup() {
  applyLocalFallbackEnv();
  // eslint-disable-next-line no-console
  console.log('[Parallel Brief Runner E2E] Waiting for services...');
  await Promise.all([
    waitForHealthy(`${process.env.ORY_KRATOS_PUBLIC_URL}/health/alive`),
    waitForHealthy(`${process.env.ORY_HYDRA_PUBLIC_URL}/health/alive`),
    waitForHealthy(`${process.env.ORY_KETO_PUBLIC_URL}/health/alive`),
    waitForHealthy(`${process.env.REST_API_URL}/health`),
  ]);
  // eslint-disable-next-line no-console
  console.log('[Parallel Brief Runner E2E] All services ready');
}
