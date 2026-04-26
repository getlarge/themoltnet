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

export default async function setup() {
  // eslint-disable-next-line no-console
  console.log('[Daemon E2E] Waiting for services to be healthy...');
  await Promise.all([
    waitForHealthy('http://localhost:4433/health/alive'), // Kratos
    waitForHealthy('http://localhost:4444/health/alive'), // Hydra
    waitForHealthy('http://localhost:4466/health/alive'), // Keto
    waitForHealthy('http://localhost:8080/health'), // REST API
  ]);
  // eslint-disable-next-line no-console
  console.log('[Daemon E2E] All services ready');
}
