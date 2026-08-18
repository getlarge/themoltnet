import { shareRolledUpEntries } from '@moltnet/dts-entry-shims';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      rollupTypes: true,
      // rollupTypes runs api-extractor once per entry, so protocol.d.ts and
      // verify.d.ts would restate declarations index.d.ts already owns — two
      // identities for one type. Collapse them onto index.d.ts (issue #1928).
      afterBuild: () => shareRolledUpEntries({ outDir: 'dist' }),
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
      input: {
        index: 'src/index.ts',
        protocol: 'src/protocol-entry.ts',
        verify: 'src/verify-entry.ts',
      },
      external: ['@themoltnet/ctap'],
    },
    rolldownOptions: {
      input: {
        index: 'src/index.ts',
        protocol: 'src/protocol-entry.ts',
        verify: 'src/verify-entry.ts',
      },
      external: ['@themoltnet/ctap'],
    },
  },
  ssr: {
    external: ['@themoltnet/ctap'],
  },
});
