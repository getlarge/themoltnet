import type { PreparedBrief } from './brief.js';
import type { LabelProjection } from './coordination.js';
import {
  createGithubIssueTransport,
  type GithubRequest,
  issueDigest,
} from './github-coordination.js';
import { publishGithubStatus } from './github-status.js';
import type { BriefPresentation } from './preparation.js';

export function createGithubBriefPresenter(input: {
  request: GithubRequest;
  repository: string;
  issueNumber: number;
  appUserId: number;
  approvalLabel: string;
  stage: string;
  labels: LabelProjection;
  stopLabels: string[];
}) {
  const transport = createGithubIssueTransport(
    input.request,
    input.repository,
    input.issueNumber,
  );
  return {
    async present(
      brief: PreparedBrief,
      expectedIssueDigest: string,
    ): Promise<BriefPresentation | null> {
      if (
        brief.workItem.provider !== 'github' ||
        brief.workItem.repository.toLowerCase() !==
          input.repository.toLowerCase() ||
        brief.workItem.key !== String(input.issueNumber)
      )
        throw new Error('Brief repository mismatch');
      const published = await publishGithubStatus({
        ...input,
        caseKey: `github:${input.repository.toLowerCase()}:${input.issueNumber}`,
        body: [
          '### SDLC brief for approval',
          '',
          String(brief.delivery.body.input.brief),
          '',
          'Acceptance criteria (pinned for delivery and independent assessment):',
          '```json',
          JSON.stringify(brief.delivery.body.input.successCriteria, null, 2),
          '```',
          '',
          `Brief digest: \`${brief.digest}\``,
          `Policy digest: \`${brief.policyDigest}\``,
          '',
          `After reviewing this brief, apply \`${input.approvalLabel}\`. If already present, remove it and apply it again.`,
          'Approval admits delivery of a draft. A human still decides whether to merge.',
        ].join('\n'),
        projection: {
          stage: input.stage,
          policy: input.labels,
          stopLabels: input.stopLabels,
          expectedIssueDigest,
        },
        isCurrent: async () => {
          const issue = await transport.readIssue();
          return (
            issue.state === 'open' &&
            issueDigest(issue) === expectedIssueDigest &&
            !input.stopLabels.some((label) => issue.labels.includes(label))
          );
        },
      });
      if (!published.published) return null;
      if (!published.updatedAt || !published.commentId)
        throw new Error('GitHub omitted the presentation timestamp');
      return {
        presentedAt: published.updatedAt,
        commentId: published.commentId,
        issueDigest: expectedIssueDigest,
        briefDigest: brief.digest,
      };
    },
  };
}
