import { nxReadySignal } from '@nx/vite/plugins/nx-ready-signal.plugin';
import { defineConfig } from 'vite';

import { externalizeInstallableDependencies } from '../../vite.shared';

const external = externalizeInstallableDependencies(
  new URL('./package.json', import.meta.url),
);

export default defineConfig({
  plugins: [nxReadySignal()],
  build: {
    emptyOutDir: true,
    outDir: 'dist',
    rolldownOptions: {
      external,
      input: 'src/main.ts',
      output: {
        banner: '#!/usr/bin/env node',
      },
    },
    ssr: true,
    target: 'node22',
  },
  ssr: {
    noExternal: [/^@moltnet\//],
  },
});
