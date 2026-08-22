import type { PrReviewInput, Rubric as RubricType } from '@moltnet/tasks';

export interface PullRequestInfo {
  title: string;
  body: string;
  url: string;
  headRefName: string;
  headRefOid: string;
  baseRefOid: string;
  commitMessages: string[];
}

const FULL_GIT_OID = /^[0-9a-f]{40}$/;

function requireFullOid(value: string, label: string): string {
  if (!FULL_GIT_OID.test(value)) {
    throw new Error(`${label} must be a full 40-character lowercase git OID`);
  }
  return value;
}

export function buildPrReviewInput(args: {
  prNumber: number;
  repoSlug: string;
  pr: PullRequestInfo;
  rubric: RubricType;
}): PrReviewInput {
  const head = requireFullOid(args.pr.headRefOid, 'headRefOid');
  const base = requireFullOid(args.pr.baseRefOid, 'baseRefOid');

  return {
    subject: {
      title: `PR #${args.prNumber}: ${args.pr.title}`,
      summary:
        `This subject is GitHub pull request ${args.pr.url} at immutable head ` +
        `${head}, compared with base ${base}. Review its complexity and ` +
        `reviewability, not functional correctness.`,
      resourceUrls: [args.pr.url],
      inspectionHints: [
        `Review only git revision ${head} against ${base}.`,
        `Use \`git diff ${base}...${head}\` and \`git show ${head}:<path>\` ` +
          'to inspect the pinned revision and surrounding code.',
      ],
    },
    taskPrompt: [
      'This review target is a GitHub pull request pinned to immutable git revisions.',
      '',
      `Repository: ${args.repoSlug}`,
      `Pull request: #${args.prNumber}`,
      `Reviewed head: ${head}`,
      `Comparison base: ${base}`,
      '',
      `1. Review exactly \`git diff ${base}...${head}\`; never substitute the pull request's current mutable head.`,
      '2. Use the local git object database to inspect touched files and enough surrounding code to judge reviewer burden.',
      '3. Emit only the required structured pr_review output. Do not create or update GitHub comments; trusted workflow code publishes the accepted output after confirming the head is still current.',
      '4. The output must include the composite score, overall verdict, and every criterion with pass/fail plus concise rationale.',
      '5. This is a complexity/reviewability judgment, not a correctness or code-quality review. The weighted composite measures review burden; low scores are expected for deliberately broad or security-sensitive changes.',
    ].join('\n'),
    successCriteria: {
      version: 1,
      rubric: args.rubric,
    },
  };
}
