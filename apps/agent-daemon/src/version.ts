declare const __MOLTNET_AGENT_VERSION__: string;

// Vite replaces the global in release bundles. The fallback keeps the
// TypeScript source executable through Node + tsx for workspace tooling.
export const DAEMON_VERSION =
  typeof __MOLTNET_AGENT_VERSION__ === 'undefined'
    ? '0.0.0-dev'
    : __MOLTNET_AGENT_VERSION__;
