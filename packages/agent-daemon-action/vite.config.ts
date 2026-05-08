import { defineConfig } from 'vite';

/**
 * Bundle the composite action's dispatch entrypoint into a single
 * self-contained Node.js script. Consumers reference the action via
 *
 *   uses: getlarge/themoltnet/packages/agent-daemon-action@vX
 *
 * GitHub clones the action repo at the requested ref, then action.yml
 * shells out to `node dist/main.js`. Bundling lets us depend on
 * @actions/core, @actions/github, @themoltnet/sdk, and the rest
 * without requiring `npm install` on the runner — composite Action
 * runners do NOT auto-inject the toolkit, so inlining is mandatory.
 *
 * Bundle size note: ~1.37 MB. This is on par with the official
 * actions/checkout (1.36 MB, @vercel/ncc) and actions/javascript-action
 * template (968 KB, rollup) — both inline their full dep tree. We
 * deliberately do NOT optimize this further (e.g. by replacing
 * @actions/github with raw fetch, or externalizing @themoltnet/sdk).
 * Rationale and the rejected alternatives are recorded in the diary
 * entry `f4ee2a8a-ed9a-4020-b06a-2412e6428955`:
 *   moltnet entry get f4ee2a8a-ed9a-4020-b06a-2412e6428955
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
    // Bundle everything. See diary entry referenced above for the
    // alternatives considered and why they were rejected.
    noExternal: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
