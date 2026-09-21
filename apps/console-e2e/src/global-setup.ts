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

export default async function globalSetup() {
  const kratosHealthUrl =
    process.env['KRATOS_HEALTH_URL'] ?? 'http://localhost:4433/health/alive';
  const apiHealthUrl =
    process.env['REST_API_HEALTH_URL'] ?? 'http://localhost:8080/health';
  const consoleUrl = process.env['CONSOLE_BASE_URL'] ?? 'http://localhost:5174';
  const mailslurperUrl =
    process.env['MAILSLURPER_API_URL'] ?? 'http://localhost:4437';

  await Promise.all([
    waitForHealthy(kratosHealthUrl),
    waitForHealthy(apiHealthUrl),
    waitForHealthy(consoleUrl),
    waitForHealthy(`${mailslurperUrl}/mail?pageNumber=1`),
  ]);
}
