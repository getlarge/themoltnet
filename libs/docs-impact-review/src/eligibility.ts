/**
 * Trust gate for the docs-impact CI workflow: decides whether a pull request
 * may run the credentialed review jobs. Kept dependency-free and limited to
 * erasable TypeScript so the `prepare` job can run it with plain `node`
 * (native type stripping) before any install.
 */
import { readFileSync } from 'node:fs';

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
  /**
   * Path prefixes of the review runtime in this repository, e.g. the workflow
   * that runs the review. A pull request touching one is not reviewed by the
   * runtime it modifies.
   */
  protectedPaths?: string[];
}

export type Eligibility =
  | { eligible: true }
  | { eligible: false; reason: string };

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
  const protectedPaths = (pr.protectedPaths ?? []).filter(
    (prefix) => prefix.length > 0,
  );
  const runtimeChanges = new Set<string>();
  for (const file of pr.files) {
    for (const path of [file.filename, file.previous_filename]) {
      if (path && protectedPaths.some((prefix) => path.startsWith(prefix))) {
        runtimeChanges.add(path);
      }
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

/** `eligibility <facts.json>` prints `skip=` and `reason=` lines. */
export function runEligibilityCli(args: string[]): void {
  const path = args[0];
  if (!path) throw new Error('usage: eligibility.ts <facts.json>');
  const facts = JSON.parse(readFileSync(path, 'utf8')) as PullRequestFacts;
  const result = checkEligibility(facts);
  const reason = result.eligible ? '' : result.reason;
  process.stdout.write(
    `skip=${String(!result.eligible)}\nreason=${reason.replace(/\n/g, ' ')}\n`,
  );
}
