import { readFileSync } from 'node:fs';

import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

import { externalizeInstallableDependencies } from '../../vite.shared';

const external = externalizeInstallableDependencies(
  new URL('./package.json', import.meta.url),
);
const packageVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  define: { __MOLTNET_AGENT_VERSION__: JSON.stringify(packageVersion.version) },
  plugins: [
    dts({
      tsconfigPath: './tsconfig.lib.json',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    }),
  ],
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        main: 'src/main.ts',
        cli: 'src/cli.ts',
        runtime: 'src/runtime.ts',
        pi: 'src/pi.ts',
      },
      external,
      output: {
        // Restore the executable shebang so npm `bin` linking works on
        // consumers' machines. Vite/Rolldown strips comment-style banners
        // from the SSR entry; we re-add it on the rendered chunk.
        banner: '#!/usr/bin/env node',
      },
    },
  },
  ssr: {
    // Published dependencies resolve from the consumer's node_modules.
    // Private workspace packages are intentionally bundled.
    noExternal: [/@moltnet\//],
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
