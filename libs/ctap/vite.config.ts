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
      input: { index: 'src/index.ts', cbor: 'src/cbor-entry.ts' },
    },
    rolldownOptions: {
      input: { index: 'src/index.ts', cbor: 'src/cbor-entry.ts' },
    },
  },
});
