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

export default async function setup() {
  // eslint-disable-next-line no-console
  console.log('[E2E Setup] Waiting for services to be healthy...');

  await Promise.all([
    waitForHealthy('http://localhost:4433/health/alive'), // Kratos
    waitForHealthy('http://localhost:4444/health/alive'), // Hydra
    waitForHealthy('http://localhost:4466/health/alive'), // Keto
    waitForHealthy('http://localhost:8080/health'), // Server
  ]);

  // eslint-disable-next-line no-console
  console.log('[E2E Setup] All services ready');
}
