import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

import { moltnetNodeRedThemeCss } from './src/theme-css.js';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: './tsconfig.lib.json',
      include: ['src/index.ts'],
    }),
    {
      name: 'write-node-red-theme-css',
      closeBundle() {
        mkdirSync(resolve(here, 'dist'), { recursive: true });
        writeFileSync(
          resolve(here, 'dist/moltnet-node-red-theme.css'),
          moltnetNodeRedThemeCss,
        );
      },
    },
  ],
  build: {
    ssr: true,
    outDir: 'dist',
    target: 'node20',
    rollupOptions: {
      input: {
        index: resolve(here, 'src/index.ts'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
      },
    },
  },
});
