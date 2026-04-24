/// <reference types="vite/client" />

interface MoltNetConfig {
  apiBaseUrl: string;
  docsUrl?: string;
}

interface Window {
  __MOLTNET_CONFIG__?: MoltNetConfig;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DOCS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
