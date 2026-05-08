import { defineConfig } from 'vite';

import { otelObservabilityExternals } from '../../vite.shared';

export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    // NOTE: deliberately not declaring rolldownOptions.input here.
    // Doing so would make @nx/vite/plugin infer a `build` target, but
    // the actual vite build is broken (cpu-features native module is
    // not externalized). Tracked separately. Once that's fixed, add:
    //   rolldownOptions: { input: 'src/main.ts' },
  },
  ssr: {
    external: [...otelObservabilityExternals],
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
