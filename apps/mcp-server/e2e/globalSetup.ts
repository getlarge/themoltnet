/**
 * E2E Global Setup & Teardown — Docker Mode
 *
 * Starts all services via docker-compose.e2e.yaml:
 *   Ory (Kratos, Hydra, Keto), Postgres, REST API server, MCP server.
 * All containers run in Docker; tests connect from the host.
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
const isCI = !!process.env.CI;
const composeFiles = isCI
  ? '-f docker-compose.e2e.yaml -f docker-compose.e2e.ci.yaml'
  : '-f docker-compose.e2e.yaml';
const composeCmd = `docker compose ${composeFiles}`;

export default async function setup() {
  // eslint-disable-next-line no-console
  console.log(
    `[MCP E2E Setup] Starting Docker Compose with e2e config${isCI ? ' (using pre-built images)' : ''}...`,
  );

  // Stop and remove all containers to ensure fresh state
  try {
    execSync(`${composeCmd} down -v --remove-orphans`, {
      cwd: composeCwd,
      stdio: 'inherit',
    });
  } catch {
    // Ignore error if nothing was running
  }

  // Start with e2e config — includes the REST API server container
  // In CI, images are pre-built and pulled; locally, build inline
  const upArgs = isCI ? 'up -d' : 'up -d --build';
  execSync(`${composeCmd} ${upArgs}`, {
    cwd: composeCwd,
    stdio: 'inherit',
    timeout: 300_000, // 5 min for image build + startup
  });

  // Wait for all services to be healthy
  // eslint-disable-next-line no-console
  console.log('[MCP E2E Setup] Waiting for services to be ready...');
  await Promise.all([
    waitForHealthy('http://localhost:4433/health/alive'), // Kratos
    waitForHealthy('http://localhost:4444/health/alive'), // Hydra
    waitForHealthy('http://localhost:4466/health/alive'), // Keto
    waitForHealthy('http://localhost:8080/health'), // REST API (combined server)
    waitForHealthy('http://localhost:8001/healthz'), // MCP server
  ]);

  // eslint-disable-next-line no-console
  console.log('[MCP E2E Setup] All services ready');

  // Return teardown function
  return async () => {
    // eslint-disable-next-line no-console
    console.log('[MCP E2E Teardown] Shutting down Docker Compose...');
    try {
      execSync(`${composeCmd} down -v --remove-orphans`, {
        cwd: composeCwd,
        stdio: 'inherit',
      });
    } catch {
      // Best-effort cleanup
    }
    // eslint-disable-next-line no-console
    console.log('[MCP E2E Teardown] Docker Compose stopped');
  };
}
