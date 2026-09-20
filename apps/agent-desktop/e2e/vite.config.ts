import { defineConfig, mergeConfig } from 'vite';

import base from '../vite.config.js';

export default defineConfig(({ mode }) =>
  mergeConfig(base, {
    plugins: [
      {
        name: 'desktop-e2e-entry',
        transformIndexHtml: {
          order: 'pre',
          handler(html: string) {
            return html.replace(
              '/src/main.tsx',
              mode === 'native-e2e'
                ? '/e2e/native-entry.ts'
                : '/e2e/chrome-entry.ts',
            );
          },
        },
      },
    ],
    build: { outDir: 'dist-e2e' },
  }),
);
