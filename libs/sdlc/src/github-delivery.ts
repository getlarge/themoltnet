import type { PreparedBrief } from './brief.js';
import type { AcceptedWork } from './contracts.js';
import { sameRevision } from './contracts.js';
import { admit, type LabelProjection } from './coordination.js';
import type { DeliveryPort } from './delivery.js';
import { readGithubApproval } from './github-admission.js';
import { githubPullRequestNumber, verifyGithubDraft } from './github-change.js';
import {
  createGithubIssueTransport,
  type GithubRequest,
  issueDigest,
} from './github-coordination.js';
import { publishGithubStatus } from './github-status.js';

/** Concrete repository half of the delivery port; contains no task execution or durable state. */
export function createGithubDeliveryRepository(input: {
  request: GithubRequest;
  repository: string;
  issueNumber: number;
  appUserId: number;
  presentation: {
    presentedAt: string;
    issueDigest: string;
    briefDigest: string;
  };
  policy: {
    eligibleLabels: string[];
    approvalLabel: string;
    pauseLabel: string;
    cancelLabel: string;
    allowedPermissions: readonly ('admin' | 'write' | 'read')[];
    baseBranch: string;
    allowedPaths: string[];
    protectedPaths: string[];
    labels: LabelProjection;
    deliveredStage: string;
  };
  /** Read only the output matching this exact accepted attempt and output CID. */
  readAcceptedOutput(work: AcceptedWork): Promise<Record<string, unknown>>;
}): Pick<DeliveryPort, 'admission' | 'control' | 'verifyChange' | 'publish'> {
  const transport = createGithubIssueTransport(
    input.request,
    input.repository,
    input.issueNumber,
  );
  const { policy } = input;
  const matches = (brief: PreparedBrief) =>
    brief.digest === input.presentation.briefDigest &&
    brief.workItem.provider === 'github' &&
    brief.workItem.repository.toLowerCase() ===
      input.repository.toLowerCase() &&
    brief.workItem.key === String(input.issueNumber);
  const port: Pick<
    DeliveryPort,
    'admission' | 'control' | 'verifyChange' | 'publish'
  > = {
    async control(brief) {
      if (!matches(brief)) return 'superseded';
      const issue = await transport.readIssue();
      if (issue.state === 'closed' || issue.labels.includes(policy.cancelLabel))
        return 'cancelled';
      if (issueDigest(issue) !== input.presentation.issueDigest)
        return 'superseded';
      if (
        issue.labels.includes(policy.pauseLabel) ||
        !issue.labels.includes(policy.approvalLabel)
      )
        return 'paused';
      if (!policy.eligibleLabels.every((label) => issue.labels.includes(label)))
        return 'superseded';
      return 'active';
    },
    async admission(brief) {
      if ((await port.control(brief)) !== 'active') return undefined;
      const approval = await readGithubApproval({
        ...input,
        label: policy.approvalLabel,
        brief: input.presentation,
        allowedPermissions: policy.allowedPermissions,
      });
      return admit({
        workItem: brief.workItem,
        briefDigest: brief.digest,
        open: true,
        eligible: true,
        paused: false,
        cancelled: false,
        approval,
      });
    },
    async verifyChange(brief, work) {
      if ((await port.control(brief)) !== 'active') return undefined;
      const output = await input.readAcceptedOutput(work);
      if (
        typeof output.pullRequestUrl !== 'string' ||
        typeof output.branch !== 'string' ||
        !Array.isArray(output.commits) ||
        !output.commits.length
      )
        return undefined;
      const pr = githubPullRequestNumber(
        output.pullRequestUrl,
        input.repository,
      );
      if (!pr) return undefined;
      const last: unknown = output.commits.at(-1);
      if (
        !last ||
        typeof last !== 'object' ||
        !('sha' in last) ||
        typeof last.sha !== 'string'
      )
        return undefined;
      const revision = await verifyGithubDraft({
        ...input,
        pr,
        expectedHead: last.sha,
        expectedBranch: output.branch,
        baseBranch: policy.baseBranch,
        allowedPaths: policy.allowedPaths,
        protectedPaths: policy.protectedPaths,
      });
      return revision
        ? {
            ...revision,
            briefDigest: brief.digest,
            policyDigest: brief.policyDigest,
          }
        : undefined;
    },
    async publish(handoff) {
      const published = await publishGithubStatus({
        ...input,
        caseKey: `github:${input.repository.toLowerCase()}:${input.issueNumber}`,
        body: [
          '### SDLC delivery',
          '',
          'Draft change delivered; assessment and review are pending.',
          `Task: \`${handoff.acceptedWork.taskId}\` · attempt ${handoff.acceptedWork.attempt}`,
          `Head: \`${handoff.revision.head}\``,
          `Brief: \`${handoff.revision.briefDigest}\``,
          '',
          'A human remains responsible for merging.',
        ].join('\n'),
        projection: {
          stage: policy.deliveredStage,
          policy: policy.labels,
          expectedIssueDigest: input.presentation.issueDigest,
          stopLabels: [policy.pauseLabel, policy.cancelLabel],
        },
        isCurrent: async () => {
          // The handoff is tied to the presentation and the exact approval event.
          if (handoff.revision.briefDigest !== input.presentation.briefDigest)
            return false;
          const issue = await transport.readIssue();
          if (
            issue.state !== 'open' ||
            issueDigest(issue) !== input.presentation.issueDigest ||
            issue.labels.includes(policy.pauseLabel) ||
            issue.labels.includes(policy.cancelLabel) ||
            !policy.eligibleLabels.every((label) =>
              issue.labels.includes(label),
            )
          )
            return false;
          const approval = await readGithubApproval({
            ...input,
            label: policy.approvalLabel,
            brief: input.presentation,
            allowedPermissions: policy.allowedPermissions,
          });
          if (approval?.eventId !== handoff.generation) return false;
          const output = await input.readAcceptedOutput(handoff.acceptedWork);
          if (
            typeof output.pullRequestUrl !== 'string' ||
            typeof output.branch !== 'string'
          )
            return false;
          const pr = githubPullRequestNumber(
            output.pullRequestUrl,
            input.repository,
          );
          if (!pr) return false;
          const current = await verifyGithubDraft({
            ...input,
            pr,
            expectedHead: handoff.revision.head,
            expectedBranch: output.branch,
            baseBranch: policy.baseBranch,
            allowedPaths: policy.allowedPaths,
            protectedPaths: policy.protectedPaths,
          });
          return Boolean(
            current &&
            sameRevision(
              {
                ...current,
                briefDigest: handoff.revision.briefDigest,
                policyDigest: handoff.revision.policyDigest,
              },
              handoff.revision,
            ),
          );
        },
      });
      return published.published;
    },
  };
  return port;
}
