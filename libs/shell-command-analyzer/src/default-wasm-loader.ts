/**
 * Node-only default resolver for the bundled `tree-sitter-bash.wasm` grammar.
 *
 * This is the single module coupled to the Node runtime (`node:module`). A
 * browser build supplies the grammar wasm explicitly via
 * `initAnalyzer({ bashWasm })`, so it never imports this file. When we add a
 * browser bundle we can map this module out via package.json `browser`/bundler
 * aliasing; the isomorphic core in `analyze.ts` stays clean.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Absolute path to the `tree-sitter-bash.wasm` grammar shipped by the
 * `tree-sitter-bash` package. `web-tree-sitter`'s `Language.load` accepts a
 * filesystem path in Node.
 */
export function resolveDefaultBashWasm(): string {
  return require.resolve('tree-sitter-bash/tree-sitter-bash.wasm');
}
