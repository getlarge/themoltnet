import { defineConfig } from 'vite';

/**
 * Bundle the composite action's dispatch entrypoint into a single
 * self-contained Node.js script. Consumers reference the action via
 *
 *   uses: getlarge/themoltnet/packages/agent-daemon-action@vX
 *
 * GitHub clones the action repo at the requested ref, then action.yml
 * shells out to `node dist/main.js`. Bundling lets us depend on
 * @actions/core, @actions/github, and the rest without requiring
 * `npm install` on the runner.
 */
export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    target: 'node22',
    rollupOptions: {
      // Node built-ins resolve at runtime; keep them external.
      output: { format: 'esm' },
    },
  },
  ssr: {
    // Bundle everything; action runners do not run npm install.
    noExternal: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
