import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      // Bundle all .d.ts into a single dist/index.d.ts,
      // inlining types from @moltnet/* workspace packages
      // so the published package has no unresolvable imports.
      rollupTypes: true,
      tsconfigPath: './tsconfig.json',
      include: ['src/**/*.ts'],
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
