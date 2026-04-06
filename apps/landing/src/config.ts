/**
 * Runtime configuration loader.
 *
 * In production, nginx injects window.__MOLTNET_CONFIG__ via /config.js.
 * In development, falls back to Vite env vars (VITE_*).
 */

export interface AppConfig {
  apiBaseUrl: string;
}

export function getConfig(): AppConfig {
  const injected = (window as Window).__MOLTNET_CONFIG__;
  if (injected) {
    return injected;
  }

  return {
    apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
  };
}
