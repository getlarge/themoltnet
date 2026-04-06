/// <reference types="vite/client" />

interface MoltNetConfig {
  kratosUrl: string;
  apiBaseUrl: string;
  consoleUrl: string;
}

interface Window {
  __MOLTNET_CONFIG__?: MoltNetConfig;
}

interface ImportMetaEnv {
  readonly VITE_KRATOS_URL?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_CONSOLE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
