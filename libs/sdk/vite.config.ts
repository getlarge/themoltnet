import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
  },
  ssr: {
    // Bundle private workspace packages into the SDK output.
    // Their transitive npm deps (@noble/ed25519, @hey-api/client-fetch)
    // stay external and are listed in dependencies.
    noExternal: [/@moltnet\//],
  },
});
