import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'dist',
    rollupOptions: {
      input: 'src/index.tsx',
      output: {
        entryFileNames: 'index.js',
        format: 'esm',
      },
      external: [
        /^node:/,
        'ink',
        'react',
        'yoga-wasm-web',
        '@yoga-layout/node',
        'chalk',
        'ansi-escapes',
        'cli-cursor',
        'cli-truncate',
        'code-excerpt',
        'slice-ansi',
        'string-length',
        'strip-ansi',
        'type-fest',
        'wrap-ansi',
      ],
    },
  },
});
