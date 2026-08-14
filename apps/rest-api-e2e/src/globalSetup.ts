/**
 * E2E global setup.
 *
 * The Compose stack must already be running. Registration is public, so the
 * suite only needs to wait for dependencies.
 */

const HYDRA_PUBLIC_URL =
  process.env['ORY_HYDRA_PUBLIC_URL'] ?? 'http://localhost:4444';
const KETO_READ_URL =
  process.env['ORY_KETO_PUBLIC_URL'] ?? 'http://localhost:4466';
const KRATOS_PUBLIC_URL =
  process.env['ORY_KRATOS_PUBLIC_URL'] ?? 'http://localhost:4433';
const REST_API_URL = process.env['SERVER_BASE_URL'] ?? 'http://localhost:8080';

async function waitForHealthy(url: string, maxAttempts = 60): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The service may still be starting.
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 2_000);
    });
  }
  throw new Error(`Service at ${url} did not become healthy`);
}

export default async function setup() {
  await Promise.all([
    waitForHealthy(new URL('/health/alive', KRATOS_PUBLIC_URL).href),
    waitForHealthy(new URL('/health/alive', HYDRA_PUBLIC_URL).href),
    waitForHealthy(new URL('/health/alive', KETO_READ_URL).href),
    waitForHealthy(new URL('/health', REST_API_URL).href),
  ]);
}
