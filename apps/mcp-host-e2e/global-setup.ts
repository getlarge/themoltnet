async function waitForHealthy(url: string, maxAttempts = 60): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Service not ready yet.
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
  BASE_URL: 'http://127.0.0.1:8082',
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
    process.env[name] ??= value;
  }
}

export default async function globalSetup() {
  applyLocalFallbackEnv();

  await Promise.all([
    waitForHealthy(`${process.env['ORY_KRATOS_PUBLIC_URL']}/health/alive`),
    waitForHealthy(`${process.env['ORY_HYDRA_PUBLIC_URL']}/health/alive`),
    waitForHealthy(`${process.env['ORY_KETO_PUBLIC_URL']}/health/alive`),
    waitForHealthy(`${process.env['REST_API_URL']}/health`),
    waitForHealthy(`${process.env['MCP_SERVER_URL']}/healthz`),
    waitForHealthy(`${process.env['BASE_URL']}/healthz`),
  ]);
}
