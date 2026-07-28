import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      rollupTypes: true,
      bundledPackages: ['@moltnet/models'],
      tsconfigPath: './tsconfig.lib.json',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    }),
  ],
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: 'src/index.ts',
    },
  },
  ssr: {
    noExternal: [/^@moltnet\//, /^typebox(?:\/.*)?$/],
  },
  test: {
    exclude: ['node_modules/**', 'dist/**'],
  },
});
