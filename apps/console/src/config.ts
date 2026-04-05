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

export function getConfig(): AppConfig {
  const injected = (window as Window).__MOLTNET_CONFIG__;
  if (injected) {
    return injected;
  }

  return {
    kratosUrl:
      (import.meta.env.VITE_KRATOS_URL as string | undefined) ??
      'http://localhost:4433',
    apiBaseUrl:
      (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
      'http://localhost:8000',
    consoleUrl:
      (import.meta.env.VITE_CONSOLE_URL as string | undefined) ??
      'http://localhost:5174',
  };
}
