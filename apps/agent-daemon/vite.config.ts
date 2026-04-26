import { defineConfig } from 'vite';

import { otelObservabilityExternals } from '../../vite.shared';

export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
  },
  ssr: {
    external: [...otelObservabilityExternals],
  },
  test: {
    exclude: ['node_modules/**', 'dist/**'],
  },
});
