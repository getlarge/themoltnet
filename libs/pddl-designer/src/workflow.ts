/**
 * NL → planning-domain design workflow, after Acitelli et al. (CAI 2026),
 * "Generating Domain Models for Automated Planning from Natural Language
 * Descriptions", with three changes found by reproducing it:
 *
 * 1. Stage outputs are typed atoms delivered through freeform output
 *    contracts, and PDDL is rendered by code instead of written by a model.
 * 2. Deterministic checks run after every stage; an invalid result gets one
 *    bounded correction task listing the exact problems.
 * 3. A planner checks the result. The grounding table and the plan (or its
 *    absence) are part of the output, because schema-valid stages can still
 *    produce a domain that cannot reach the goal or that skips required work.
 *
 * The returned DesignRun holds everything a reviewer or a UI needs: each
 * stage's brief, result and findings, the rendered PDDL, and the plan check.
 */
import { createHash } from 'node:crypto';

import {
  createInlineContext,
  type TaskClient,
  waitForTaskOutcome,
} from '@themoltnet/tasks-orchestrator';

import {
  checkActions,
  checkPredicates,
  checkTypes,
  hasErrors,
  type Issue,
} from './check.js';
import type { Domain, Problem } from './ir.js';
import {
  checkPlan,
  DEFAULT_LIMITS,
  type GroundingRow,
  type PlannerLimits,
  type PlanResult,
  type Reachability,
} from './planner.js';
import { checkProblemWithReachability } from './problem-check.js';
import { renderDomain, renderProblem } from './render.js';
import {
  buildActionsTask,
  buildPredicatesTask,
  buildProblemTask,
  buildRefineTask,
  buildTypesTask,
  type Correction,
  type DesignInput,
  parseActions,
  parsePredicates,
  parseProblem,
  parseRefine,
  parseTypes,
  type StageName,
  type StageTaskBody,
} from './stages.js';

export interface StageRecord {
  stage: StageName;
  attempt: number;
  taskId: string;
  brief: string;
  result: unknown;
  issues: Issue[];
  durationMs: number;
}

export type DesignStatus =
  | 'planned'
  | 'unsolvable'
  | 'search_limit'
  | 'invalid'
  | 'failed';

export interface DesignRun {
  version: 1;
  status: DesignStatus;
  failure?: { stage: StageName; reason: string };
  input: Pick<
    DesignInput,
    | 'description'
    | 'problemDescription'
    | 'domainName'
    | 'problemName'
    | 'correlationId'
  >;
  stages: StageRecord[];
  domain?: Domain;
  problem?: Problem;
  domainPddl?: string;
  problemPddl?: string;
  /** Changes the refine stage reports making to the draft actions. */
  refinements?: string[];
  /** Warnings that remain on the final domain and problem. */
  issues: Issue[];
  grounding?: GroundingRow[];
  reachability?: Reachability;
  plan?: PlanResult;
  durationMs: number;
}

export interface DesignOptions {
  /** Correction tasks allowed per stage after a result fails the checks. */
  maxCorrections?: number;
  pollIntervalSec?: number;
  limits?: PlannerLimits;
}

class StageStopped extends Error {
  constructor(
    readonly stage: StageName,
    readonly status: 'invalid' | 'failed',
    reason: string,
  ) {
    super(reason);
  }
}

function idempotencyKey(input: DesignInput, stage: string, attempt: number) {
  const digest = createHash('sha256')
    .update(`${input.correlationId}\0${stage}\0${attempt}`)
    .digest('base64url');
  return 'pddl:' + digest;
}

export async function runPddlDesign(
  tasks: TaskClient,
  input: DesignInput,
  options: DesignOptions = {},
): Promise<DesignRun> {
  const started = Date.now();
  const maxCorrections = options.maxCorrections ?? 1;
  const ctx = {
    ...createInlineContext(),
    sleepFor: (_name: string, seconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, seconds * 1000);
      }),
  };
  const run: DesignRun = {
    version: 1,
    status: 'failed',
    input: {
      description: input.description,
      problemDescription: input.problemDescription,
      domainName: input.domainName,
      problemName: input.problemName,
      correlationId: input.correlationId,
    },
    stages: [],
    issues: [],
    durationMs: 0,
  };

  /** Run one stage, retrying with a correction while checks report errors. */
  async function stage<T>(
    name: StageName,
    build: (attempt: number, correction?: Correction) => StageTaskBody,
    parse: (output: unknown) => T,
    check: (result: T) => Issue[],
  ): Promise<{ result: T; issues: Issue[] }> {
    let correction: Correction | undefined;
    for (let attempt = 1; attempt <= maxCorrections + 1; attempt++) {
      const stageStart = Date.now();
      const body = build(attempt, correction);
      const task = await tasks.createTask(body, {
        idempotencyKey: idempotencyKey(input, name, attempt),
      });
      const outcome = await waitForTaskOutcome(task.id, {
        tasks,
        ctx,
        pollIntervalSec: options.pollIntervalSec ?? 2,
        parse,
      });
      if (outcome.kind !== 'accepted')
        throw new StageStopped(name, 'failed', outcome.reason);
      const result = outcome.result.state;
      const issues = check(result);
      run.stages.push({
        stage: name,
        attempt,
        taskId: task.id,
        brief: body.input.brief,
        result,
        issues,
        durationMs: Date.now() - stageStart,
      });
      if (!hasErrors(issues)) return { result, issues };
      correction = {
        previous: result,
        issues: issues.filter((i) => i.severity === 'error'),
      };
    }
    throw new StageStopped(
      name,
      'invalid',
      `still failing checks after ${maxCorrections} correction(s)`,
    );
  }

  try {
    const types = await stage(
      'types',
      (n, c) => buildTypesTask(input, n, c),
      parseTypes,
      (r) => checkTypes(r.types),
    );
    const predicates = await stage(
      'predicates',
      (n, c) => buildPredicatesTask(input, types.result, n, c),
      parsePredicates,
      (r) => checkPredicates(types.result.types, r.predicates),
    );
    const draft = await stage(
      'actions',
      (n, c) => buildActionsTask(input, types.result, predicates.result, n, c),
      parseActions,
      (r) =>
        checkActions(
          types.result.types,
          predicates.result.predicates,
          r.actions,
        ),
    );
    const refined = await stage(
      'refine',
      (n, c) =>
        buildRefineTask(
          input,
          types.result,
          predicates.result,
          draft.result.actions,
          draft.issues,
          n,
          c,
        ),
      parseRefine,
      (r) =>
        checkActions(
          types.result.types,
          predicates.result.predicates,
          r.actions,
        ),
    );
    const domain: Domain = {
      name: input.domainName,
      types: types.result.types,
      predicates: predicates.result.predicates,
      actions: refined.result.actions,
    };
    run.domain = domain;
    run.refinements = refined.result.changes;
    run.domainPddl = renderDomain(domain);

    const parameterTypes = [
      ...new Set(
        domain.actions.flatMap((a) => a.parameters.map((p) => p.type)),
      ),
    ];
    const problemStage = await stage(
      'problem',
      (n, c) =>
        buildProblemTask(input, run.domainPddl ?? '', parameterTypes, n, c),
      parseProblem,
      (r) => checkProblemWithReachability(domain, r, input.problemName),
    );
    const problem: Problem = {
      name: input.problemName,
      ...problemStage.result,
    };
    run.problem = problem;
    run.problemPddl = renderProblem(problem, domain.name);
    run.issues = [...refined.issues, ...problemStage.issues];

    const check = checkPlan(domain, problem, options.limits ?? DEFAULT_LIMITS);
    run.grounding = check.grounding;
    run.reachability = check.reachability;
    run.plan = check.plan;
    run.status =
      check.plan.status === 'found'
        ? 'planned'
        : check.plan.status === 'unsolvable'
          ? 'unsolvable'
          : 'search_limit';
  } catch (error) {
    if (!(error instanceof StageStopped)) throw error;
    run.status = error.status;
    run.failure = { stage: error.stage, reason: error.message };
  }
  run.durationMs = Date.now() - started;
  return run;
}
