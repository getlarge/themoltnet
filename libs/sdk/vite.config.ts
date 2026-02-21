import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

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
      tsconfigPath: './tsconfig.json',
      include: ['src/**/*.ts'],
      compilerOptions: {
        paths: {
          '@moltnet/api-client': ['../api-client/dist/index.d.ts'],
          '@moltnet/crypto-service': ['../crypto-service/dist/index.d.ts'],
        },
      },
    }),
  ],
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
  },
  ssr: {
    // Bundle private workspace packages into the SDK JS output.
    // Their transitive npm deps (@noble/ed25519)
    // stay external and are listed in dependencies.
    noExternal: [/@moltnet\//],
  },
});
