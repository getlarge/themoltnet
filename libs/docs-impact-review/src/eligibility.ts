/**
 * Trust gate shared by the docs-impact and adaptive review workflows: decides
 * whether a pull request may run their credentialed review jobs. A rule change
 * here changes both workflows. Kept dependency-free and limited to
 * erasable TypeScript so the `prepare` job can run it with plain `node`
 * (native type stripping) before any install.
 */

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
   * GitHub's changed-file count. The files endpoint stops at 3,000 entries, so
   * a shorter `files` list may hide a protected path and is never reviewed.
   */
  changedFiles: number;
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

/**
 * GitHub lists changed files relative to the repository root, so a prefix
 * written as `./.github/` or `/.github/` means `.github/`.
 */
function normalizePrefix(prefix: string): string {
  return prefix.trim().replace(/^(?:\.?\/)+/, '');
}

export function checkEligibility(pr: PullRequestFacts): Eligibility {
  if (pr.files.length < pr.changedFiles) {
    return {
      eligible: false,
      reason: `GitHub listed ${pr.files.length} of ${pr.changedFiles} changed files, so the protected paths cannot be checked`,
    };
  }
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
  const protectedPaths = (pr.protectedPaths ?? [])
    .map(normalizePrefix)
    .filter((prefix) => prefix.length > 0);
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
