import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Carry the workspace's reviewed release exceptions into isolated consumers. */
export function writePackedConsumerPolicy(repoRoot, consumerDir) {
  const workspace = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  const block = workspace.match(
    /^minimumReleaseAgeExclude:\n(?:[ \t].*\n|\n)*/m,
  )?.[0];
  const age = workspace.match(/^minimumReleaseAge:.*$/m)?.[0];
  if (!age || !block)
    throw new Error('Workspace release-age exclusions are missing');
  writeFileSync(join(consumerDir, 'pnpm-workspace.yaml'), `${age}\n${block}`);
}
