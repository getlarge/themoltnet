/**
 * E2E Global Setup
 *
 * Restarts Docker Compose with e2e config to ensure clean state.
 * Runs once before all e2e tests.
 */

import { execSync } from 'node:child_process';

export default async function setup() {
  // eslint-disable-next-line no-console
  console.log('[E2E Setup] Restarting Docker Compose with e2e config...');

  // Stop any running compose services
  try {
    execSync('docker compose -f docker-compose.e2e.yaml down', {
      cwd: process.cwd() + '/../..',
      stdio: 'inherit',
    });
  } catch {
    // Ignore error if nothing was running
  }

  // Start with e2e config (no volumes = fresh state)
  execSync(
    'COMPOSE_PROFILES=dev docker compose -f docker-compose.e2e.yaml up -d --wait',
    {
      cwd: process.cwd() + '/../..',
      stdio: 'inherit',
      timeout: 120000, // 2 minute timeout
    },
  );

  // eslint-disable-next-line no-console
  console.log('[E2E Setup] Docker Compose ready');
}
