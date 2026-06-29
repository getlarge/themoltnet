import { rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: './tsconfig.lib.json',
      include: ['src/index.ts'],
    }),
    {
      name: 'write-node-red-theme-css',
      async closeBundle() {
        const themeCssPath = resolve(here, 'dist/theme-css.js');
        const themeCssModule = (await import(
          `${pathToFileURL(themeCssPath).href}?t=${Date.now()}`
        )) as {
          moltnetNodeRedThemeCss: string;
        };

        writeFileSync(
          resolve(here, 'dist/moltnet-node-red-theme.css'),
          themeCssModule.moltnetNodeRedThemeCss,
        );
        rmSync(themeCssPath, { force: true });
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
        'theme-css': resolve(here, 'src/theme-css.ts'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
      },
    },
  },
});
