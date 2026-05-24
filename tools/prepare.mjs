#!/usr/bin/env node
// Root `prepare` hook.
//
// Bootstraps husky git hooks for local dev. Silent no-op in environments
// where husky is not installed (production installs with --prod), where the
// user explicitly disables it (HUSKY=0), or where there is no `.git/` (e.g.
// a tarball install or a CI checkout without history).
//
// Mirrors the conventions documented at
// https://typicode.github.io/husky/how-to.html#with-pnpm — except we avoid
// the "husky || true" trick because pnpm reports the non-zero exit as a
// failure even with `|| true` in some shells.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';

if (process.env.HUSKY === '0' || process.env.CI === 'true') {
  process.exit(0);
}

if (!existsSync('.git')) {
  process.exit(0);
}

const result = spawnSync('husky', [], { stdio: 'inherit', shell: true });
// Treat "husky not on PATH" (ENOENT or 127) as a silent skip — that's the
// expected state in a --prod install.
if (result.error?.code === 'ENOENT' || result.status === 127) {
  process.exit(0);
}
process.exit(result.status ?? 0);
