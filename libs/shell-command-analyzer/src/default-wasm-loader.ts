/**
 * Node-only default resolver for the vendored `tree-sitter-bash.wasm` grammar
 * (see `wasm/`, refreshed via `pnpm run wasm:sync`).
 *
 * This is the single module coupled to the Node runtime (`node:url`). A browser
 * build swaps it for `default-wasm-loader.browser.ts` via the package.json
 * `browser` field, so bundlers never pull `node:url` in; browser callers must
 * inject the grammar with `initAnalyzer({ bashWasm })`.
 */

import { fileURLToPath } from 'node:url';

/**
 * Filesystem path to the grammar wasm shipped in this package.
 * `web-tree-sitter`'s `Language.load` accepts a filesystem path in Node.
 */
export function resolveDefaultBashWasm(): string {
  return fileURLToPath(
    new URL('../wasm/tree-sitter-bash.wasm', import.meta.url),
  );
}
