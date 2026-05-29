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
  /** Public documentation site. Optional; defaults to https://docs.themolt.net. */
  docsUrl: string;
}

const DEFAULT_DOCS_URL = 'https://docs.themolt.net';

function normalizeUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function getConfig(): AppConfig {
  const injected = (window as Window).__MOLTNET_CONFIG__;
  const injectedKratosUrl = normalizeUrl(injected?.kratosUrl);
  const injectedApiBaseUrl = normalizeUrl(injected?.apiBaseUrl);
  const injectedConsoleUrl = normalizeUrl(injected?.consoleUrl);
  // docsUrl is non-critical: fall back to the public default rather than
  // requiring it in injected runtime config (keeps existing /config.js valid).
  const docsUrl = normalizeUrl(injected?.docsUrl) || DEFAULT_DOCS_URL;

  if (injectedKratosUrl && injectedApiBaseUrl && injectedConsoleUrl) {
    return {
      kratosUrl: injectedKratosUrl,
      apiBaseUrl: injectedApiBaseUrl,
      consoleUrl: injectedConsoleUrl,
      docsUrl,
    };
  }

  const isProd = import.meta.env.PROD || import.meta.env.MODE === 'production';

  if (isProd) {
    throw new Error(
      'Missing runtime config: window.__MOLTNET_CONFIG__ must include kratosUrl, apiBaseUrl, and consoleUrl. Ensure /config.js is served correctly in production.',
    );
  }

  return {
    kratosUrl:
      normalizeUrl(import.meta.env.VITE_KRATOS_URL) || 'http://localhost:4433',
    apiBaseUrl:
      normalizeUrl(import.meta.env.VITE_API_BASE_URL) ||
      'http://localhost:8000',
    consoleUrl:
      normalizeUrl(import.meta.env.VITE_CONSOLE_URL) || 'http://localhost:5174',
    docsUrl: normalizeUrl(import.meta.env.VITE_DOCS_URL) || DEFAULT_DOCS_URL,
  };
}
