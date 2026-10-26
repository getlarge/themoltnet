import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Carry the workspace's reviewed release exceptions into isolated consumers.
 * `overrides` goes into the consumer's pnpm-workspace.yaml because pnpm 12
 * ignores the `pnpm` field of package.json.
 */
export function writePackedConsumerPolicy(repoRoot, consumerDir, overrides) {
  const workspace = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  const block = workspace.match(
    /^minimumReleaseAgeExclude:\n(?:[ \t].*\n|\n)*/m,
  )?.[0];
  const age = workspace.match(/^minimumReleaseAge:.*$/m)?.[0];
  if (!age || !block)
    throw new Error('Workspace release-age exclusions are missing');
  const pinned = Object.entries(overrides ?? {})
    .map(
      ([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}\n`,
    )
    .join('');
  writeFileSync(
    join(consumerDir, 'pnpm-workspace.yaml'),
    `${age}\n${block}${pinned ? `overrides:\n${pinned}` : ''}`,
  );
}
