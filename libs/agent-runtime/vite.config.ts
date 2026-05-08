import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      rollupTypes: true,
      bundledPackages: ['@moltnet/tasks'],
      tsconfigPath: './tsconfig.json',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      compilerOptions: {
        paths: {
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
      input: 'src/index.ts',
    },
  },
  ssr: {
    noExternal: [/@moltnet\//],
  },
});
