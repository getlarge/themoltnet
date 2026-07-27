import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      // Bundle .d.ts per entry, inlining types from the private @moltnet/*
      // workspace packages (@moltnet/tasks) so the published package has no
      // unresolvable imports. @themoltnet/sdk and absurd-sdk stay external
      // (real dependencies), so their imports remain in the emitted types.
      //
      // Point @moltnet/tasks at its pre-built dist/*.d.ts rather than source,
      // matching @themoltnet/sdk — the workspace exports["types"] field points
      // at src/index.ts, which would make vite-plugin-dts inline full
      // implementation types instead of the compiled declarations.
      rollupTypes: true,
      tsconfigPath: './tsconfig.lib.json',
      include: ['src/**/*.ts'],
      compilerOptions: {
        paths: {
          '@moltnet/tasks': ['../tasks/dist/index.d.ts'],
        },
      },
    }),
  ],
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    // Mirror the SSR entry as rollupOptions/rolldownOptions.input so
    // @nx/vite/plugin recognizes this as buildable (its isBuildable check reads
    // build.lib || rollupOptions.input || rolldownOptions.input — but NOT
    // build.ssr). Vite's actual build is still driven by build.ssr.
    rollupOptions: {
      input: {
        index: 'src/index.ts',
        testing: 'src/testing.ts',
      },
    },
    rolldownOptions: {
      input: {
        index: 'src/index.ts',
        testing: 'src/testing.ts',
      },
    },
  },
  ssr: {
    // Bundle the private @moltnet/* workspace packages into the JS output.
    // @themoltnet/sdk (published) and absurd-sdk (npm) stay external and are
    // listed in dependencies.
    noExternal: [/@moltnet\//],
  },
});
