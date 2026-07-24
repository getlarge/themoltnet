import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      rollupTypes: true,
      tsconfigPath: './tsconfig.lib.json',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    }),
  ],
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { index: 'src/index.ts', verify: 'src/verify-entry.ts' },
      external: ['@themoltnet/ctap'],
    },
    rolldownOptions: {
      input: { index: 'src/index.ts', verify: 'src/verify-entry.ts' },
      external: ['@themoltnet/ctap'],
    },
  },
  ssr: {
    external: ['@themoltnet/ctap'],
  },
});
