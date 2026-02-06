import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
  },
});
