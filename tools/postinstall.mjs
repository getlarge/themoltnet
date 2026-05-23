#!/usr/bin/env node
// Root postinstall hook.
//
// `nx sync` keeps tsconfig project references in sync with workspace deps. It
// requires the full workspace + nx to be on PATH, so it MUST be skipped in
// minimal environments — most notably the Docker `build` stage which runs
// `pnpm install --prod` (no dev deps → no nx binary) before `pnpm deploy`.
// Set MOLTNET_SKIP_NX_SYNC=1 to skip.
//
// Same pattern as HUSKY=0 (which silences `prepare: husky` in the same envs).

import { spawnSync } from 'node:child_process';

if (process.env.MOLTNET_SKIP_NX_SYNC === '1') {
  process.exit(0);
}

const result = spawnSync('nx', ['sync'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
