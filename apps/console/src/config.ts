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
  /** Local signer companion. Never receives browser credentials. */
  signerUrl: string;
  /** Local Agent Server. Never receives browser credentials. */
  agentServerUrl: string;
  /**
   * Retention window applied to an unpinned pack, in days.
   *
   * Mirrors the rest-api's `PACK_GC_COMPILE_TTL_DAYS`, which is what the server
   * uses when it creates a pack. The console has to send an explicit
   * `expiresAt` when unpinning (the API rejects a bare `{ pinned: false }`), so
   * it must compute the same window or it silently rewrites the operator's
   * retention policy. Injected via /config.js from the same env var; see #1858
   * for moving this arithmetic to the server, which removes the need to keep
   * the two deployments in sync.
   */
  packGcTtlDays: number;
}

const DEFAULT_DOCS_URL = 'https://docs.themolt.net';
const DEFAULT_SIGNER_URL = 'http://127.0.0.1:17373';
const DEFAULT_AGENT_SERVER_URL = 'https://127.0.0.1:17374';
/** Matches the rest-api default in `apps/rest-api/src/config.ts`. */
const DEFAULT_PACK_GC_TTL_DAYS = 7;

/**
 * Any finite positive number, NOT an integer.
 *
 * `PACK_GC_COMPILE_TTL_DAYS` is `Type.Number()` on the server, so a
 * sub-day window such as `0.5` (12 hours) is valid there. Flooring it here
 * would turn 0.5 into 0 — an unpin deadline of "now", which PATCH then
 * rejects for not being in the future — and would silently shorten 1.5 to 1.
 */
function normalizePositiveNumber(
  value: string | number | undefined,
): number | undefined {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
    ? parsed
    : undefined;
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
  // docsUrl is non-critical: fall back to the public default rather than
  // requiring it in injected runtime config (keeps existing /config.js valid).
  const docsUrl = normalizeUrl(injected?.docsUrl) || DEFAULT_DOCS_URL;
  const signerUrl = normalizeUrl(injected?.signerUrl) || DEFAULT_SIGNER_URL;
  const agentServerUrl =
    normalizeUrl(injected?.agentServerUrl) || DEFAULT_AGENT_SERVER_URL;
  // Non-critical: an unset or malformed value falls back rather than blocking
  // boot, since a wrong retention window is far less bad than a dead console.
  const packGcTtlDays =
    normalizePositiveNumber(injected?.packGcTtlDays) ??
    DEFAULT_PACK_GC_TTL_DAYS;

  if (injectedKratosUrl && injectedApiBaseUrl && injectedConsoleUrl) {
    return {
      kratosUrl: injectedKratosUrl,
      apiBaseUrl: injectedApiBaseUrl,
      consoleUrl: injectedConsoleUrl,
      docsUrl,
      signerUrl,
      agentServerUrl,
      packGcTtlDays,
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
    signerUrl:
      normalizeUrl(import.meta.env.VITE_SIGNER_URL) || DEFAULT_SIGNER_URL,
    agentServerUrl:
      normalizeUrl(import.meta.env.VITE_AGENT_SERVER_URL) ||
      DEFAULT_AGENT_SERVER_URL,
    packGcTtlDays:
      normalizePositiveNumber(import.meta.env.VITE_PACK_GC_TTL_DAYS) ??
      DEFAULT_PACK_GC_TTL_DAYS,
  };
}
