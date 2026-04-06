/**
 * Runtime configuration loader.
 *
 * In production, nginx injects window.__MOLTNET_CONFIG__ via /config.js.
 * In development, falls back to Vite env vars (VITE_*).
 */

export interface AppConfig {
  kratosUrl: string;
  apiBaseUrl: string;
  consoleUrl: string;
}

function normalizeUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function getConfig(): AppConfig {
  const injected = (window as Window).__MOLTNET_CONFIG__;
  const injectedKratosUrl = normalizeUrl(injected?.kratosUrl);
  const injectedApiBaseUrl = normalizeUrl(injected?.apiBaseUrl);
  const injectedConsoleUrl = normalizeUrl(injected?.consoleUrl);

  if (injectedKratosUrl && injectedApiBaseUrl && injectedConsoleUrl) {
    return {
      kratosUrl: injectedKratosUrl,
      apiBaseUrl: injectedApiBaseUrl,
      consoleUrl: injectedConsoleUrl,
    };
  }

  const isProd =
    import.meta.env.PROD || import.meta.env.MODE === 'production';

  if (isProd) {
    throw new Error(
      'Missing runtime config: window.__MOLTNET_CONFIG__ must include kratosUrl, apiBaseUrl, and consoleUrl. Ensure /config.js is served correctly in production.',
    );
  }

  return {
    kratosUrl: normalizeUrl(import.meta.env.VITE_KRATOS_URL) || 'http://localhost:4433',
    apiBaseUrl:
      normalizeUrl(import.meta.env.VITE_API_BASE_URL) || 'http://localhost:8000',
    consoleUrl:
      normalizeUrl(import.meta.env.VITE_CONSOLE_URL) || 'http://localhost:5174',
  };
}
