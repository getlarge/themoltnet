import { defineConfig } from 'vite';

/**
 * Bundles the reviewer's three command-line entry points into self-contained
 * Node.js scripts that action.yml runs with `node`. A composite action gets no
 * `npm install`, and bundling keeps the action and the reviewer it runs at
 * one version. Dependencies are inlined, as in agent-daemon-action; the OS
 * keyring adapter is loaded lazily by the SDK and never reached in CI, where
 * the agent authenticates with MOLTNET_AGENT_KEY.
 */
export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      input: {
        review: 'src/review.ts',
        comment: 'src/comment.ts',
        eligibility: 'src/eligibility.ts',
      },
      output: { format: 'esm', entryFileNames: '[name].js' },
    },
  },
  ssr: {
    noExternal: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
