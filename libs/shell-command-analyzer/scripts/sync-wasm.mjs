#!/usr/bin/env node
/**
 * Refresh the vendored `wasm/tree-sitter-bash.wasm` from the `tree-sitter-bash`
 * dev dependency. Run after bumping the grammar version:
 *
 *   pnpm --filter @themoltnet/shell-command-analyzer run wasm:sync
 *
 * We vendor just the wasm asset (~1.3 MB) so the runtime install does not pull
 * the full grammar package (~24 MiB of native/generated artifacts).
 */

import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const source = require.resolve('tree-sitter-bash/tree-sitter-bash.wasm');
const dest = resolve(here, '../wasm/tree-sitter-bash.wasm');

copyFileSync(source, dest);
console.error(`Copied ${source}\n     -> ${dest}`);
