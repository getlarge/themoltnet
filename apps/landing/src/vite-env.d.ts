/// <reference types="vite/client" />

interface MoltNetConfig {
  apiBaseUrl: string;
}

interface Window {
  __MOLTNET_CONFIG__?: MoltNetConfig;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
