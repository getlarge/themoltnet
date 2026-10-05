/**
 * Problem-stage checks that need grounding: facts that can never become true.
 *
 * Reachability ignores delete effects, so it is cheap and sound: if a goal
 * fact is unreachable here, no plan exists. Actions that can never fire are
 * reported with the facts they lack, which tells the problem stage which
 * initial facts are missing (an agent never marked free, a pool never made
 * available) or tells a reviewer that no action produces them.
 */
import { checkProblem, type Issue } from './check.js';
import type { Domain, ProblemResult } from './ir.js';
import { DEFAULT_LIMITS, ground, relaxedReachability } from './planner.js';

export function checkProblemWithReachability(
  domain: Domain,
  problem: ProblemResult,
  problemName = 'problem',
): Issue[] {
  const issues = checkProblem(
    domain.types,
    domain.predicates,
    domain.actions,
    problem,
  );
  if (issues.some((i) => i.severity === 'error')) return issues;
  let grounded: ReturnType<typeof ground>;
  try {
    grounded = ground(
      domain,
      { name: problemName, ...problem },
      DEFAULT_LIMITS,
    );
  } catch {
    return issues; // too large to ground here; the plan check reports the limit
  }
  const reach = relaxedReachability(grounded.actions, {
    name: problemName,
    ...problem,
  });
  for (const goal of reach.unreachableGoals)
    issues.push({
      severity: 'error',
      path: 'goal',
      message: `${goal} can never become true, even ignoring what actions delete`,
    });
  const severity = reach.unreachableGoals.length ? 'error' : 'warning';
  for (const b of reach.blocked)
    issues.push({
      severity,
      path: `actions/${b.action}`,
      message: b.rootMissing.length
        ? `can never run: ${b.example} needs ${b.rootMissing.join(' ')}, which no action adds and the initial facts do not contain`
        : `can never run because the actions that produce ${b.missing.join(' ')} can never run either`,
    });
  return issues;
}
