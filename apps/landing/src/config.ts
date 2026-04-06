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
  const injectedApiBaseUrl = injected?.apiBaseUrl?.trim();

  if (injectedApiBaseUrl) {
    return {
      apiBaseUrl: injectedApiBaseUrl,
    };
  }

  const isProd =
    import.meta.env.PROD || import.meta.env.MODE === 'production';

  if (isProd) {
    throw new Error(
      'Missing runtime config: window.__MOLTNET_CONFIG__.apiBaseUrl was not injected. Ensure /config.js is served correctly in production.',
    );
  }

  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL?.trim() || 'http://localhost:8000';

  return {
    apiBaseUrl,
  };
}
