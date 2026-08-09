import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

import { externalizeInstallableDependencies } from '../../vite.shared';

const external = externalizeInstallableDependencies(
  new URL('./package.json', import.meta.url),
);

export default defineConfig({
  plugins: [
    dts({
      // Bundle all .d.ts into a single dist/index.d.ts,
      // inlining types from @moltnet/* workspace packages
      // so the published package has no unresolvable imports.
      //
      // We override paths to point at the pre-built dist/*.d.ts files
      // rather than source .ts files — the workspace exports["types"] field
      // points to src/index.ts which would cause vite-plugin-dts to inline
      // full class implementations into the .d.ts output.
      rollupTypes: true,
      tsconfigPath: './tsconfig.lib.json',
      include: ['src/**/*.ts'],
      compilerOptions: {
        paths: {
          '@moltnet/agent-config': ['../agent-config/out-tsc/index.d.ts'],
          '@moltnet/api-client': ['../api-client/dist/index.d.ts'],
          '@moltnet/crypto-service': ['../crypto-service/dist/index.d.ts'],
          '@moltnet/models': ['../models/out-tsc/index.d.ts'],
          '@themoltnet/os-keyring': ['../os-keyring/dist/index.d.ts'],
          '@moltnet/tasks': ['../tasks/dist/index.d.ts'],
        },
      },
    }),
  ],
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    // Mirror the SSR entry as rolldownOptions.input so @nx/vite/plugin
    // recognizes this as buildable (its isBuildable check reads
    // build.lib || builder.buildApp || rollupOptions.input ||
    // rolldownOptions.input — but NOT build.ssr). Vite's actual build
    // is still driven by build.ssr; this field is a hint to the Nx
    // inference layer.
    rollupOptions: {
      external,
      input: {
        human: 'src/human.ts',
        index: 'src/index.ts',
        node: 'src/node.ts',
      },
    },
    rolldownOptions: {
      external,
      input: {
        human: 'src/human.ts',
        index: 'src/index.ts',
        node: 'src/node.ts',
      },
    },
  },
  ssr: {
    // Bundle private workspace packages into the SDK JS output.
    // Their transitive npm deps (@noble/ed25519)
    // stay external and are listed in dependencies.
    noExternal: [/@moltnet\//],
  },
});
