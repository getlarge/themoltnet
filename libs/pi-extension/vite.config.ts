import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      // Bundle all .d.ts into a single dist/index.d.ts, inlining types
      // from @moltnet/* workspace packages so the published tarball has
      // no unresolvable imports. Same pattern as @themoltnet/sdk.
      //
      // `compilerOptions.paths` overrides the workspace exports["types"]
      // (which points at src/index.ts) to use the pre-built dist/*.d.ts
      // files — otherwise vite-plugin-dts would inline full class bodies
      // into the output, not just the type surface.
      //
      // `bundledPackages` forces api-extractor to inline types from the
      // listed packages rather than treat them as external imports. Needed
      // because @moltnet/agent-runtime re-exports types from @moltnet/tasks
      // transitively (e.g. `TaskMessage` / `TaskUsage` appear in the
      // `TaskReporter` interface's public method signatures), and without
      // this flag api-extractor leaves those as `import type { … } from
      // '@moltnet/tasks'` in the bundled output.
      rollupTypes: true,
      bundledPackages: ['@moltnet/agent-runtime', '@moltnet/tasks'],
      tsconfigPath: './tsconfig.json',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      compilerOptions: {
        paths: {
          '@moltnet/agent-runtime': ['../agent-runtime/dist/index.d.ts'],
          '@moltnet/tasks': ['../tasks/dist/index.d.ts'],
        },
      },
    }),
  ],
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
    emptyOutDir: true,
  },
  ssr: {
    // Bundle private workspace packages into the JS output. Their
    // transitive npm deps (e.g. @sinclair/typebox) stay external and
    // are listed in dependencies.
    noExternal: [/^@moltnet\//],
  },
});
