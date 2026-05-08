import { defineConfig } from 'vite';

import { otelObservabilityExternals } from '../../vite.shared';

export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    // Mirror the SSR entry as rolldownOptions.input so @nx/vite/plugin
    // recognizes this as buildable (its isBuildable check reads
    // build.lib || builder.buildApp || rollupOptions.input ||
    // rolldownOptions.input — but NOT build.ssr).
    rolldownOptions: {
      input: 'src/main.ts',
    },
  },
  ssr: {
    external: [...otelObservabilityExternals],
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
