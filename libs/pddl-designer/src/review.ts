/**
 * Review a found plan for shortcuts the description forbids.
 *
 * Planning proves a plan exists, not that it follows the description. In live
 * runs most plans skipped a described step (its result was never required) or
 * let one item's work satisfy another item's goal. Both are found by
 * re-planning without a step (forcedAnalysis). Which skippable steps the
 * description actually requires is a judgment, answered by a decision model:
 * "required by the description" and "skippable by the planner" is a shortcut.
 */
import type { Issue } from './check.js';
import type { DecisionClient } from './decision.js';
import type { Domain, Problem } from './ir.js';
import {
  DEFAULT_LIMITS,
  type ForcedAnalysis,
  forcedAnalysis,
  type PlannerLimits,
} from './planner.js';

export interface ReviewOptions {
  decisions?: DecisionClient;
  /** Probability above which a step counts as required. Default 0.9. */
  threshold?: number;
  limits?: PlannerLimits;
}

export interface PlanReview extends ForcedAnalysis {
  /** Decision-model probability that each skippable step is required. */
  required: Record<string, number>;
  findings: Issue[];
}

export async function reviewPlan(
  domain: Domain,
  problem: Problem,
  texts: { description: string; situation: string },
  options: ReviewOptions = {},
): Promise<PlanReview> {
  const analysis = forcedAnalysis(
    domain,
    problem,
    options.limits ?? DEFAULT_LIMITS,
  );
  const threshold = options.threshold ?? 0.9;
  const required: Record<string, number> = {};
  const findings: Issue[] = [];
  const byName = new Map(domain.actions.map((a) => [a.name, a]));

  if (options.decisions) {
    for (const name of analysis.skippable) {
      const action = byName.get(name);
      const p = await options.decisions.yesNo(
        {
          process: texts.description,
          situation: texts.situation,
          step: name,
          step_meaning: action?.source ?? '',
        },
        {
          instructions:
            'To reach the goal in this situation, must this step happen at least once according to the process?',
          criteria: {
            false:
              'The goal can be reached without this step in this situation',
            true: 'The process requires this step before the goal is reached in this situation',
          },
        },
      );
      required[name] = p;
      if (p >= threshold) {
        const adds = (action?.addEffects ?? []).map((x) => x.predicate);
        findings.push({
          severity: 'error',
          code: 'required-step-skippable',
          path: `actions/${name}`,
          message: `the description requires ${name} in this situation, but every plan can skip it: no later step or goal needs what it adds (${adds.join(', ') || 'nothing'}). Make the step that should follow it require that fact.`,
        });
      }
    }
  }
  for (const shared of analysis.shared) {
    const action = byName.get(shared.action);
    const adds = (action?.addEffects ?? []).map((x) => x.predicate);
    findings.push({
      severity: 'error',
      code: 'shared-work',
      path: `actions/${shared.action}`,
      message: `${shared.items.join(' and ')} can each reach their goal without their own ${shared.action}: one item's result serves the others. Make what ${shared.action} adds (${adds.join(', ') || 'nothing'}) name the item, and require that item-specific fact in the step that completes the item.`,
    });
  }
  return { ...analysis, required, findings };
}
