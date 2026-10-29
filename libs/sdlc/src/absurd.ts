import { createOrchestrationAbsurdApp } from '@themoltnet/tasks-orchestrator';

import { type AssessmentInput, runAssessment } from './assessment.js';
import {
  type ConvergencePolicy,
  type ConvergencePort,
  runConvergence,
} from './convergence.js';
import { type DeliveryPort, runDelivery } from './delivery.js';
import { type OutcomeInput, runOutcome } from './outcome.js';
import { type PreparationInput, runPreparation } from './preparation.js';

export const SDLC_CONVERGENCE_TASK = 'sdlc_convergence_v1';

export function createConvergenceApp(args: {
  databaseUrl: string;
  queueName: string;
  /** Bind each durable execution to its own repository/change adapter. */
  port: (changeKey: string) => ConvergencePort;
}) {
  return createOrchestrationAbsurdApp<{
    changeKey: string;
    policy: ConvergencePolicy;
  }>({
    databaseUrl: args.databaseUrl,
    queueName: args.queueName,
    taskName: SDLC_CONVERGENCE_TASK,
    run: (input, ctx) =>
      runConvergence(input.policy, args.port(input.changeKey), ctx),
  });
}

export const SDLC_DELIVERY_TASK = 'sdlc_delivery_v1';
export function createDeliveryApp(args: {
  databaseUrl: string;
  queueName: string;
  port: (changeKey: string) => DeliveryPort;
}) {
  return createOrchestrationAbsurdApp<
    Parameters<typeof runDelivery>[0] & { changeKey: string }
  >({
    databaseUrl: args.databaseUrl,
    queueName: args.queueName,
    taskName: SDLC_DELIVERY_TASK,
    run: (input, ctx) => runDelivery(input, args.port(input.changeKey), ctx),
  });
}

export const SDLC_ASSESSMENT_TASK = 'sdlc_assessment_v1';
export function createAssessmentApp(args: {
  databaseUrl: string;
  queueName: string;
  deps: (input: AssessmentInput) => Parameters<typeof runAssessment>[1];
}) {
  return createOrchestrationAbsurdApp<AssessmentInput>({
    databaseUrl: args.databaseUrl,
    queueName: args.queueName,
    taskName: SDLC_ASSESSMENT_TASK,
    run: (input, ctx) => runAssessment(input, args.deps(input), ctx),
  });
}

export const SDLC_PREPARATION_TASK = 'sdlc_prepare_v1';
export function createPreparationApp(args: {
  databaseUrl: string;
  queueName: string;
  port: (input: PreparationInput) => Parameters<typeof runPreparation>[1];
}) {
  return createOrchestrationAbsurdApp<PreparationInput>({
    databaseUrl: args.databaseUrl,
    queueName: args.queueName,
    taskName: SDLC_PREPARATION_TASK,
    run: (input, ctx) => runPreparation(input, args.port(input), ctx),
  });
}

export const SDLC_OUTCOME_TASK = 'sdlc_outcome_v1';
export function createOutcomeApp(args: {
  databaseUrl: string;
  queueName: string;
  deps: (input: OutcomeInput) => Parameters<typeof runOutcome>[1];
}) {
  return createOrchestrationAbsurdApp<OutcomeInput>({
    databaseUrl: args.databaseUrl,
    queueName: args.queueName,
    taskName: SDLC_OUTCOME_TASK,
    run: (input, ctx) => runOutcome(input, args.deps(input), ctx),
  });
}

export const SDLC_REVIEW_START_TASK = 'sdlc_review_start_v1';
