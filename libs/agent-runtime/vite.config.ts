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
        '@moltnet/models',
        '@moltnet/runtime-profiles',
        '@moltnet/tasks',
      ],
      tsconfigPath: './tsconfig.lib.json',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      compilerOptions: {
        paths: {
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
    // Mirror the SSR entry as rolldownOptions.input so @nx/vite/plugin
    // recognizes this as buildable (its isBuildable check reads
    // build.lib || builder.buildApp || rollupOptions.input ||
    // rolldownOptions.input — but NOT build.ssr).
    rolldownOptions: {
      external,
      input: 'src/index.ts',
    },
  },
  ssr: {
    noExternal: [/@moltnet\//],
  },
});
