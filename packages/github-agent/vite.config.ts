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
      tsconfigPath: './tsconfig.lib.json',
      include: ['src/**/*.ts'],
      compilerOptions: {
        paths: {
          '@moltnet/agent-config': [
            '../../libs/agent-config/out-tsc/index.d.ts',
          ],
        },
      },
    }),
  ],
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      external,
      input: 'src/index.ts',
    },
  },
  ssr: {
    noExternal: [/@moltnet\//],
  },
});
