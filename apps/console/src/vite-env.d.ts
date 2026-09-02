/// <reference types="vite/client" />

interface MoltNetConfig {
  kratosUrl: string;
  apiBaseUrl: string;
  consoleUrl: string;
  docsUrl?: string;
  signerUrl?: string;
  serveUrl?: string;
  /** String because nginx injects it via envsubst; parsed in config.ts. */
  packGcTtlDays?: string;
}

interface Window {
  __MOLTNET_CONFIG__?: MoltNetConfig;
}

interface ImportMetaEnv {
  readonly VITE_KRATOS_URL?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_CONSOLE_URL?: string;
  readonly VITE_DOCS_URL?: string;
  readonly VITE_SIGNER_URL?: string;
  readonly VITE_SERVE_URL?: string;
  readonly VITE_PACK_GC_TTL_DAYS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
