import type { Agent, AgentSigningCapability } from '@themoltnet/sdk';
import {
  createOrchestrationAbsurdApp,
  createTaskStep,
} from '@themoltnet/tasks-orchestrator';

import {
  SDLC_ASSESSMENT_TASK,
  SDLC_DELIVERY_TASK,
  SDLC_OUTCOME_TASK,
  SDLC_PREPARATION_TASK,
  SDLC_REVIEW_START_TASK,
} from './absurd.js';
import {
  type AssessmentInput,
  runAssessment,
  verifyAcceptedAssessment,
} from './assessment.js';
import { type AcceptedWork, sameRevision } from './contracts.js';
import { runDelivery } from './delivery.js';
import {
  githubPullRequestNumber,
  verifyGithubChange,
} from './github-change.js';
import type { GithubRequest } from './github-coordination.js';
import { createGithubDeliveryRepository } from './github-delivery.js';
import { githubOutcomeIsCurrent } from './github-outcome.js';
import { createGithubBriefPresenter } from './github-preparation.js';
import { markGithubReady } from './github-ready.js';
import { publishGithubStatus } from './github-status.js';
import { createMoltNetDeliveryPort } from './moltnet-delivery.js';
import { type OutcomeInput, runOutcome } from './outcome.js';
import { type PreparationInput, runPreparation } from './preparation.js';

export type GithubDeliveryInput = Parameters<typeof runDelivery>[0] & {
  github: Omit<
    Parameters<typeof createGithubDeliveryRepository>[0],
    'request' | 'readAcceptedOutput'
  >;
};

/** Runnable provider composition. All nonsecret policy and presentation data live in durable task params. */
export function createGithubMoltNetDeliveryApp(options: {
  databaseUrl: string;
  queueName: string;
  agent: Agent;
  request: GithubRequest;
}) {
  return createOrchestrationAbsurdApp<GithubDeliveryInput>({
    databaseUrl: options.databaseUrl,
    queueName: options.queueName,
    taskName: SDLC_DELIVERY_TASK,
    async run(input, ctx) {
      const principal = await options.agent.agents.whoami();
      if (principal.subjectType !== 'agent')
        throw new Error('SDLC delivery requires an agent principal');
      const original = await ctx.step('delivery.principal', () =>
        Promise.resolve(principal.subjectId),
      );
      if (original !== principal.subjectId)
        throw new Error('Delivery principal changed during recovery');
      const repository = deliveryRepository(
        options.agent,
        options.request,
        input.github,
        input.brief.delivery.teamId,
      );
      const port = createMoltNetDeliveryPort({
        tasks: options.agent.tasks,
        teamId: input.brief.delivery.teamId,
        proposerAgentId: principal.subjectId,
        repository,
      });
      return runDelivery(input, port, ctx);
    },
  });
}

export type GithubPreparationInput = PreparationInput & {
  github: Omit<Parameters<typeof createGithubBriefPresenter>[0], 'request'>;
};
export function createGithubPreparationApp(options: {
  databaseUrl: string;
  queueName: string;
  request: GithubRequest;
}) {
  return createOrchestrationAbsurdApp<GithubPreparationInput>({
    databaseUrl: options.databaseUrl,
    queueName: options.queueName,
    taskName: SDLC_PREPARATION_TASK,
    run: (input, ctx) =>
      runPreparation(
        input,
        createGithubBriefPresenter({
          ...input.github,
          request: options.request,
        }),
        ctx,
      ),
  });
}

export type GithubAssessmentInput = AssessmentInput & {
  github: GithubDeliveryInput['github'];
};

/** Assessment checks the same provider admission and draft identity as delivery. */
export function createGithubMoltNetAssessmentApp(options: {
  databaseUrl: string;
  queueName: string;
  agent: Agent;
  request: GithubRequest;
}) {
  return createOrchestrationAbsurdApp<GithubAssessmentInput>({
    databaseUrl: options.databaseUrl,
    queueName: options.queueName,
    taskName: SDLC_ASSESSMENT_TASK,
    async run(input, ctx) {
      const principal = await options.agent.agents.whoami();
      if (principal.subjectType !== 'agent')
        throw new Error('SDLC assessment requires an agent principal');
      const original = await ctx.step('assessment.principal', () =>
        Promise.resolve(principal.subjectId),
      );
      if (original !== principal.subjectId)
        throw new Error('Assessment principal changed during recovery');
      const repository = deliveryRepository(
        options.agent,
        options.request,
        input.github,
        input.brief.delivery.teamId,
      );
      return runAssessment(
        input,
        {
          agent: options.agent,
          proposerAgentId: principal.subjectId,
          current: () =>
            repository.verifyChange(input.brief, input.delivery.acceptedWork),
          active: async () => {
            const admission = await repository.admission(input.brief);
            return admission?.approvalEventId === input.delivery.generation;
          },
        },
        ctx,
      );
    },
  });
}

function deliveryRepository(
  agent: Agent,
  requestGithub: GithubRequest,
  github: GithubDeliveryInput['github'],
  teamId: string,
) {
  return createGithubDeliveryRepository({
    ...github,
    request: requestGithub,
    readAcceptedOutput: (work) => acceptedOutput(agent, teamId, work),
  });
}

export function createGithubMoltNetOutcomeApp(options: {
  databaseUrl: string;
  queueName: string;
  agent: Agent;
  signer: Pick<AgentSigningCapability, 'signDiaryEntry'>;
  request: GithubRequest;
}) {
  return createOrchestrationAbsurdApp<OutcomeInput>({
    databaseUrl: options.databaseUrl,
    queueName: options.queueName,
    taskName: SDLC_OUTCOME_TASK,
    run: (input, ctx) =>
      runOutcome(
        input,
        {
          agent: options.agent,
          signer: options.signer,
          isCurrent: (value) => githubOutcomeIsCurrent(value, options.request),
        },
        ctx,
      ),
  });
}

async function acceptedOutput(
  agent: Agent,
  teamId: string,
  work: AcceptedWork,
) {
  const task = await agent.tasks.get(work.taskId, { teamId });
  const attempts = await agent.tasks.listAttempts(work.taskId, { teamId });
  const attempt = attempts.find((value) => value.attemptN === work.attempt);
  if (
    task.status !== 'completed' ||
    task.acceptedAttemptN !== work.attempt ||
    !attempt ||
    attempt.taskId !== task.id ||
    attempt.status !== 'completed' ||
    attempt.outputCid !== work.outputCid ||
    !attempt.output
  )
    throw new Error('Accepted output no longer matches handoff');
  return attempt.output;
}

export type GithubReviewStartInput = Pick<
  GithubAssessmentInput,
  'brief' | 'delivery' | 'github'
> & { assessment: AcceptedWork };
export function createGithubMoltNetReviewStartApp(options: {
  databaseUrl: string;
  queueName: string;
  agent: Agent;
  request: GithubRequest;
}) {
  return createOrchestrationAbsurdApp<GithubReviewStartInput>({
    databaseUrl: options.databaseUrl,
    queueName: options.queueName,
    taskName: SDLC_REVIEW_START_TASK,
    async run(input, ctx) {
      const frozen = await ctx.step('review-start.input', () =>
        Promise.resolve(structuredClone(input)),
      );
      const principal = await options.agent.agents.whoami();
      if (principal.subjectType !== 'agent')
        throw new Error('Review start requires an agent principal');
      const owner = await ctx.step('review-start.principal', () =>
        Promise.resolve(principal.subjectId),
      );
      if (owner !== principal.subjectId)
        throw new Error('Review-start principal changed during recovery');
      const repository = deliveryRepository(
        options.agent,
        options.request,
        frozen.github,
        frozen.brief.delivery.teamId,
      );
      const output = await acceptedOutput(
        options.agent,
        frozen.brief.delivery.teamId,
        frozen.delivery.acceptedWork,
      );
      const pr = githubPullRequestNumber(
        output.pullRequestUrl,
        frozen.github.repository,
      );
      const branch = output.branch;
      if (!pr || typeof branch !== 'string')
        throw new Error('Invalid accepted PR identity');
      const isAuthorized = async () => {
        if (!(await verifyAcceptedAssessment(frozen, options.agent)))
          return false;
        const admission = await repository.admission(frozen.brief);
        if (admission?.approvalEventId !== frozen.delivery.generation)
          return false;
        const current = await verifyGithubChange({
          request: options.request,
          repository: frozen.github.repository,
          pr,
          expectedHead: frozen.delivery.revision.head,
          expectedBranch: branch,
          baseBranch: frozen.github.policy.baseBranch,
          allowedPaths: frozen.github.policy.allowedPaths,
          protectedPaths: frozen.github.policy.protectedPaths,
        });
        return Boolean(
          current &&
          sameRevision(
            { ...frozen.delivery.revision, ...current },
            frozen.delivery.revision,
          ),
        );
      };
      const started = await createTaskStep(
        ctx,
        'review-start.ready',
        ({ idempotencyKey }) => {
          if (!idempotencyKey)
            throw new Error('Missing review-start operation identity');
          return markGithubReady({
            request: options.request,
            repository: frozen.github.repository,
            pr,
            revision: frozen.delivery.revision,
            key: idempotencyKey,
            isAuthorized,
          });
        },
      );
      if (!started) return { started: false, published: false };
      const publication = await ctx.step('review-start.publish', () =>
        publishGithubStatus({
          ...frozen.github,
          request: options.request,
          caseKey: `github:${frozen.github.repository.toLowerCase()}:${frozen.github.issueNumber}`,
          body: `### SDLC review

Independent assessment passed for head \`${frozen.delivery.revision.head}\`. CI and review may now run.

A human remains responsible for merging.`,
          projection: {
            stage: frozen.github.policy.deliveredStage,
            policy: frozen.github.policy.labels,
            expectedIssueDigest: frozen.github.presentation.issueDigest,
            stopLabels: [
              frozen.github.policy.pauseLabel,
              frozen.github.policy.cancelLabel,
            ],
          },
          isCurrent: isAuthorized,
        }),
      );
      return { started: true, published: publication.published };
    },
  });
}
