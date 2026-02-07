/**
 * E2E Global Setup & Teardown — Docker Mode
 *
 * Setup: Starts Docker Compose with e2e config (includes server container).
 * Teardown: Shuts down Docker Compose after all tests complete.
 */

import { execSync } from 'node:child_process';

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

const composeCwd = process.cwd() + '/../..';

export default async function setup() {
  // eslint-disable-next-line no-console
  console.log(
    '[E2E Setup] Restarting Docker Compose with e2e config (building server)...',
  );

  // Stop and remove all containers to ensure fresh state
  try {
    execSync(
      'docker compose -f docker-compose.e2e.yaml down -v --remove-orphans',
      {
        cwd: composeCwd,
        stdio: 'inherit',
      },
    );
  } catch {
    // Ignore error if nothing was running
  }

  // Start with e2e config — includes the server container
  execSync('docker compose -f docker-compose.e2e.yaml up -d --build', {
    cwd: composeCwd,
    stdio: 'inherit',
    timeout: 300_000, // 5 min for image build + startup
  });

  // Wait for Ory services and the server container to be healthy
  // eslint-disable-next-line no-console
  console.log('[E2E Setup] Waiting for services to be ready...');
  await Promise.all([
    waitForHealthy('http://localhost:4433/health/alive'), // Kratos
    waitForHealthy('http://localhost:4444/health/alive'), // Hydra
    waitForHealthy('http://localhost:4466/health/alive'), // Keto
    waitForHealthy('http://localhost:8080/health'), // Server
  ]);

  // eslint-disable-next-line no-console
  console.log('[E2E Setup] All services ready (including server container)');

  // Return teardown function — Vitest calls this after all tests complete
  return async () => {
    // eslint-disable-next-line no-console
    console.log('[E2E Teardown] Shutting down Docker Compose...');
    try {
      execSync(
        'docker compose -f docker-compose.e2e.yaml down -v --remove-orphans',
        {
          cwd: composeCwd,
          stdio: 'inherit',
        },
      );
    } catch {
      // Best-effort cleanup
    }
    // eslint-disable-next-line no-console
    console.log('[E2E Teardown] Docker Compose stopped');
  };
}
