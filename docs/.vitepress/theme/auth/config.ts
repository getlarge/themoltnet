/**
 * Runtime configuration for the docs auth integration.
 *
 * VitePress is built statically and served by GitHub Pages, so there is no
 * nginx wrapper to inject `window.__MOLTNET_CONFIG__` (as the console does).
 * We still honour an injected config object if present — for parity with the
 * console and to allow a future runtime override — and fall back to the
 * build-time `VITE_KRATOS_URL`, then to the production URL.
 */

export interface AuthConfig {
  kratosUrl: string;
}

const DEFAULT_KRATOS_URL = 'https://auth.themolt.net';

function trim(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v || undefined;
}

export function getAuthConfig(): AuthConfig {
  if (typeof window !== 'undefined') {
    const injected = (
      window as unknown as { __MOLTNET_CONFIG__?: { kratosUrl?: string } }
    ).__MOLTNET_CONFIG__;
    const injectedUrl = trim(injected?.kratosUrl);
    if (injectedUrl) return { kratosUrl: injectedUrl };
  }
  return {
    kratosUrl: trim(import.meta.env.VITE_KRATOS_URL) ?? DEFAULT_KRATOS_URL,
  };
}
