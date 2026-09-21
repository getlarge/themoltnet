import { fileURLToPath } from 'node:url';

import { defineConfig, loadConfigFromFile, mergeConfig } from 'vite';

export default defineConfig(async (env) => {
  const base = await loadConfigFromFile(
    env,
    fileURLToPath(new URL('../agent-desktop/vite.config.ts', import.meta.url)),
  );
  if (!base) throw new Error('Desktop Vite configuration could not be loaded');
  return mergeConfig(base.config, {
    root: fileURLToPath(new URL('.', import.meta.url)),
    // Scan the real entry before mocks mount React; late dependency discovery
    // would reload the page and discard the bridge mocks.
    optimizeDeps: {
      entries: [
        fileURLToPath(
          new URL('../agent-desktop/src/main.tsx', import.meta.url),
        ),
      ],
    },
    plugins: [
      {
        name: 'desktop-e2e-entry',
        transformIndexHtml: {
          order: 'pre',
          handler(html: string) {
            return html.replace(
              '/src/main.tsx',
              env.mode === 'native-e2e'
                ? '/src/native-entry.ts'
                : '/src/chrome-entry.ts',
            );
          },
        },
      },
    ],
    build: { outDir: 'dist' },
  });
});
