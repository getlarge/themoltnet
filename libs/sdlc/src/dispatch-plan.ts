import { createHash } from 'node:crypto';

import { SDLC_PREPARATION_TASK } from './absurd.js';
import { prepareBrief } from './brief.js';
import type { GithubPreparationInput } from './github-moltnet.js';
import {
  parseRepositoryPolicy,
  type RepositoryPolicy,
} from './repository-policy.js';

export interface PreparationRequest {
  issueNumber: number;
  issueDigest: string;
  correlationId: string;
  brief: Parameters<typeof prepareBrief>[0]['brief'];
}

/** One independently dispatched stage, with all effective policy in durable params. */
export function planGithubPreparation(
  rawPolicy: unknown,
  request: PreparationRequest,
) {
  const { policy, digest } = parseRepositoryPolicy(rawPolicy);
  if (
    !Number.isSafeInteger(request.issueNumber) ||
    request.issueNumber < 1 ||
    !/^[a-f0-9]{64}$/.test(request.issueDigest)
  )
    throw new Error('Preparation requires an issue number and content digest');
  const params: GithubPreparationInput & { policySnapshot: RepositoryPolicy } =
    {
      policySnapshot: structuredClone(policy),
      authoring: {
        workItem: {
          provider: 'github',
          repository: policy.repository,
          key: String(request.issueNumber),
        },
        policyDigest: digest,
        teamId: policy.teamId,
        diaryId: policy.diaryId,
        correlationId: request.correlationId,
        brief: structuredClone(request.brief),
        delivery: policy.executors.delivery,
        assessment: policy.executors.assessment,
      },
      issueDigest: request.issueDigest,
      github: {
        repository: policy.repository,
        issueNumber: request.issueNumber,
        appUserId: policy.appUserId,
        approvalLabel: policy.github.approvalLabel,
        stage: 'preparation',
        labels: policy.github.labels,
        stopLabels: [policy.github.pauseLabel, policy.github.cancelLabel],
      },
    };
  // Normalize and validate the task/rubric before dispatching any external write.
  const brief = prepareBrief(params.authoring);
  return {
    taskName: SDLC_PREPARATION_TASK,
    params,
    policy,
    policyDigest: digest,
    briefDigest: brief.digest,
    idempotencyKey: `sdlc:prepare:${createHash('sha256')
      .update(
        JSON.stringify([
          policy.repository,
          request.issueNumber,
          request.issueDigest,
          brief.digest,
        ]),
      )
      .digest('hex')}`,
  };
}
