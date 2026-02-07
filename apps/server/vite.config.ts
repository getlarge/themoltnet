import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
  },
  ssr: {
    // drizzle-orm ships pure ESM with no default export; Vite's CJS interop
    // incorrectly generates a default import when externalizing it. Bundling
    // it inline avoids the broken interop.
    noExternal: ['drizzle-orm'],
  },
});
