import type { Agent, AgentSigningCapability } from '@themoltnet/sdk';
import { createOrchestrationAbsurdApp } from '@themoltnet/tasks-orchestrator';

import {
  SDLC_ASSESSMENT_TASK,
  SDLC_DELIVERY_TASK,
  SDLC_OUTCOME_TASK,
  SDLC_PREPARATION_TASK,
} from './absurd.js';
import { type AssessmentInput, runAssessment } from './assessment.js';
import { runDelivery } from './delivery.js';
import type { GithubRequest } from './github-coordination.js';
import { createGithubDeliveryRepository } from './github-delivery.js';
import { githubOutcomeIsCurrent } from './github-outcome.js';
import { createGithubBriefPresenter } from './github-preparation.js';
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
  const request = { teamId };
  return createGithubDeliveryRepository({
    ...github,
    request: requestGithub,
    async readAcceptedOutput(work) {
      const task = await agent.tasks.get(work.taskId, request);
      const attempts = await agent.tasks.listAttempts(work.taskId, request);
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
    },
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
