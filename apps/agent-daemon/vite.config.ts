import { defineConfig } from 'vite';

import { otelObservabilityExternals } from '../../vite.shared';

const runtimeExternals = [
  ...otelObservabilityExternals,
  '@themoltnet/agent-daemon-state',
  '@themoltnet/agent-runtime',
  '@themoltnet/pi-extension',
  '@themoltnet/sdk',
  '@earendil-works/gondolin',
  'pino',
  'pino-pretty',
  // SSH2 + cpu-features carry .node native bindings that rolldown
  // cannot inline. They reach us via Gondolin -> ssh2.
  'ssh2',
  'cpu-features',
  // pi-extension declares these as peerDeps so the daemon must list
  // them as runtime deps; consumers must `npm install` them too.
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-ai',
];

export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    rollupOptions: {
      external: runtimeExternals,
      output: {
        // Restore the executable shebang so npm `bin` linking works on
        // consumers' machines. Vite/Rolldown strips comment-style banners
        // from the SSR entry; we re-add it on the rendered chunk.
        banner: '#!/usr/bin/env node',
      },
    },
  },
  ssr: {
    // Externals stay un-bundled and are resolved by `npm install` on the
    // consumer side. Keep published workspace deps + their native-binding
    // transitive deps here. Private workspace deps (e.g. @moltnet/tasks)
    // get inlined by SSR's default behavior.
    external: runtimeExternals,
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
