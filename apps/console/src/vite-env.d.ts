/// <reference types="vite/client" />

interface MoltNetConfig {
  kratosUrl: string;
  apiBaseUrl: string;
  consoleUrl: string;
}

interface Window {
  __MOLTNET_CONFIG__?: MoltNetConfig;
}
