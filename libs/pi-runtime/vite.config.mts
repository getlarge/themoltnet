import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

import { externalizeInstallableDependencies } from '../../vite.shared';

const external = externalizeInstallableDependencies(
  new URL('./package.json', import.meta.url),
);

export default defineConfig({
  plugins: [
    dts({
      rollupTypes: true,
      bundledPackages: [
        '@moltnet/crypto-service',
        '@moltnet/models',
        '@moltnet/runtime-profiles',
        '@moltnet/tasks',
      ],
      tsconfigPath: './tsconfig.lib.json',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      compilerOptions: {
        // api-extractor must read the pre-built declarations of bundled
        // private packages, not their source-direct exports.
        paths: {
          '@moltnet/crypto-service': ['../crypto-service/dist/index.d.ts'],
          '@moltnet/crypto-service/agent-signing': [
            '../crypto-service/dist/agent-signing.d.ts',
          ],
          '@moltnet/crypto-service/content-cid': [
            '../crypto-service/dist/content-cid.d.ts',
          ],
          '@moltnet/crypto-service/json-cid': [
            '../crypto-service/dist/json-cid.d.ts',
          ],
          '@moltnet/crypto-service/canonical-json': [
            '../crypto-service/dist/canonical-json.d.ts',
          ],
          '@moltnet/runtime-profiles': ['../runtime-profiles/dist/index.d.ts'],
          '@moltnet/runtime-profiles/context-recipes': [
            '../runtime-profiles/dist/runtime-profile-context-recipes.d.ts',
          ],
          '@moltnet/tasks': ['../tasks/dist/index.d.ts'],
        },
      },
    }),
  ],
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      // Published workspace dependencies are installed by package consumers.
      // In particular, the analyzer owns runtime WASM assets whose
      // import.meta.url paths are detached when its source export is bundled.
      external,
      input: 'src/index.ts',
    },
  },
  ssr: {
    noExternal: [/^@moltnet\//],
  },
  test: {
    exclude: ['node_modules/**', 'dist/**'],
  },
});
