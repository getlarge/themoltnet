/**
 * Browser build of the default wasm loader (swapped in via the package.json
 * `browser` field). There is no default grammar in the browser — the runtime
 * has no filesystem — so callers must inject it explicitly.
 */
export function resolveDefaultBashWasm(): never {
  throw new Error(
    'shell-command-analyzer: no default bash grammar in the browser — pass ' +
      'initAnalyzer({ bashWasm }) (a URL or Uint8Array of tree-sitter-bash.wasm).',
  );
}
