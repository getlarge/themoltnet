/// <reference types="vite/client" />

interface MoltNetConfig {
  kratosUrl: string;
  apiBaseUrl: string;
  dashboardUrl: string;
}

interface Window {
  __MOLTNET_CONFIG__?: MoltNetConfig;
}
