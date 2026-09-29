/**
 * Trust gate for the docs-impact CI workflow: decides whether a pull request
 * may run the credentialed review jobs. Kept dependency-free and limited to
 * erasable TypeScript so the `prepare` job can run it with plain `node`
 * (native type stripping) before any install.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export interface PullRequestFile {
  filename: string;
  /** Present on renames; the old path is checked as well as the new one. */
  previous_filename?: string;
}

export interface PullRequestFacts {
  /** `owner/repo` of the head branch; null when the fork was deleted. */
  headRepo: string | null;
  baseRepo: string;
  author: string;
  files: PullRequestFile[];
}

export type Eligibility =
  | { eligible: true }
  | { eligible: false; reason: string };

/**
 * The trusted review runtime. A PR touching it must not be reviewed by the
 * runtime it modifies.
 */
export const RUNTIME_PATH_PREFIXES = [
  '.github/workflows/docs-impact-review.yml',
  '.github/runtime-profiles/legreffier-docs-review-',
  '.github/runtime-policies/',
  'apps/docs-impact-review/',
  'packages/agent-daemon-action/',
];

function touchesRuntime(path: string): boolean {
  return RUNTIME_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function checkEligibility(pr: PullRequestFacts): Eligibility {
  // Fork PRs run without secrets and cannot publish; a deleted fork is
  // treated the same way.
  if (pr.headRepo !== pr.baseRepo) {
    return { eligible: false, reason: 'fork pull requests are not reviewed' };
  }
  if (pr.author === 'dependabot[bot]') {
    return {
      eligible: false,
      reason: 'Dependabot pull requests are not reviewed',
    };
  }
  const runtimeChanges = new Set<string>();
  for (const file of pr.files) {
    for (const path of [file.filename, file.previous_filename]) {
      if (path && touchesRuntime(path)) runtimeChanges.add(path);
    }
  }
  if (runtimeChanges.size > 0) {
    return {
      eligible: false,
      reason: `the PR changes the trusted review runtime (${[...runtimeChanges].sort().join(', ')})`,
    };
  }
  return { eligible: true };
}

/** `node eligibility.ts <facts.json>` prints `skip=` and `reason=` lines. */
function main(): void {
  const path = process.argv[2];
  if (!path) throw new Error('usage: eligibility.ts <facts.json>');
  const facts = JSON.parse(readFileSync(path, 'utf8')) as PullRequestFacts;
  const result = checkEligibility(facts);
  const reason = result.eligible ? '' : result.reason;
  process.stdout.write(
    `skip=${String(!result.eligible)}\nreason=${reason.replace(/\n/g, ' ')}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
