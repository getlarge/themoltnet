/**
 * A small classical planner over the typed IR: STRIPS with typing and negative
 * preconditions, the fragment the stages are allowed to produce.
 *
 * It is a checker, not a production planner. Breadth-first search returns a
 * shortest plan, and the grounding table explains a failure: an action with
 * zero concrete instances names the parameter type that has no objects.
 * Larger models should be handed to Fast Downward with the rendered PDDL.
 */
import { isSubtype } from './check.js';
import type { Atom, Domain, Literal, Problem } from './ir.js';

export interface GroundAction {
  label: string;
  action: string;
  pre: string[];
  neg: string[];
  add: string[];
  del: string[];
}

export interface GroundingRow {
  action: string;
  /** Number of concrete actions after substituting objects. */
  instances: number;
  /** Parameters whose type has no object at all. */
  emptyParameters: string[];
}

export type PlanResult =
  | { status: 'found'; steps: string[]; explored: number }
  | { status: 'unsolvable'; explored: number }
  | { status: 'limit'; explored: number; reason: string };

export interface PlanCheck {
  grounding: GroundingRow[];
  plan: PlanResult;
}

export interface PlannerLimits {
  /** Maximum concrete actions before grounding stops. */
  maxGroundActions: number;
  /** Maximum distinct states the search may visit. */
  maxStates: number;
}

export const DEFAULT_LIMITS: PlannerLimits = {
  maxGroundActions: 50_000,
  maxStates: 200_000,
};

const key = (predicate: string, args: string[]) =>
  [predicate, ...args].join(' ');

class LimitExceeded extends Error {}

export function ground(
  domain: Domain,
  problem: Problem,
  limits: PlannerLimits = DEFAULT_LIMITS,
): { actions: GroundAction[]; rows: GroundingRow[] } {
  const actions: GroundAction[] = [];
  const rows: GroundingRow[] = [];
  for (const a of domain.actions) {
    const choices = a.parameters.map((p) =>
      problem.objects
        .filter((o) => isSubtype(domain.types, o.type, p.type))
        .map((o) => o.name),
    );
    const emptyParameters = a.parameters
      .filter((_, i) => choices[i].length === 0)
      .map((p) => `${p.name} - ${p.type}`);
    let instances = 0;
    const walk = (i: number, binding: Map<string, string>) => {
      if (i === a.parameters.length) {
        if (actions.length >= limits.maxGroundActions)
          throw new LimitExceeded(
            `more than ${limits.maxGroundActions} concrete actions`,
          );
        const sub = (x: Atom | Literal) =>
          key(
            x.predicate,
            x.args.map((arg) => binding.get(arg) ?? arg),
          );
        actions.push({
          label: `(${[a.name, ...a.parameters.map((p) => binding.get(p.name))].join(' ')})`,
          action: a.name,
          pre: a.preconditions.filter((x) => !x.negated).map(sub),
          neg: a.preconditions.filter((x) => x.negated).map(sub),
          add: a.addEffects.map(sub),
          del: a.deleteEffects.map(sub),
        });
        instances += 1;
        return;
      }
      for (const object of choices[i]) {
        binding.set(a.parameters[i].name, object);
        walk(i + 1, binding);
      }
      binding.delete(a.parameters[i].name);
    };
    walk(0, new Map());
    rows.push({ action: a.name, instances, emptyParameters });
  }
  return { actions, rows };
}

export function applicable(state: Set<string>, op: GroundAction): boolean {
  return op.pre.every((f) => state.has(f)) && !op.neg.some((f) => state.has(f));
}

/** STRIPS update: state minus deletes, plus adds. */
export function apply(state: Set<string>, op: GroundAction): Set<string> {
  const next = new Set(state);
  for (const f of op.del) next.delete(f);
  for (const f of op.add) next.add(f);
  return next;
}

const stateKey = (state: Set<string>) => [...state].sort().join('|');

export function search(
  actions: GroundAction[],
  problem: Problem,
  limits: PlannerLimits = DEFAULT_LIMITS,
): PlanResult {
  const start = new Set(problem.init.map((x) => key(x.predicate, x.args)));
  const goalPos = problem.goal
    .filter((x) => !x.negated)
    .map((x) => key(x.predicate, x.args));
  const goalNeg = problem.goal
    .filter((x) => x.negated)
    .map((x) => key(x.predicate, x.args));
  const isGoal = (s: Set<string>) =>
    goalPos.every((f) => s.has(f)) && !goalNeg.some((f) => s.has(f));

  const parent = new Map<string, { prev: string; op: string } | null>([
    [stateKey(start), null],
  ]);
  const queue: Set<string>[] = [start];
  for (let head = 0; head < queue.length; head++) {
    const state = queue[head];
    if (isGoal(state)) {
      const steps: string[] = [];
      let cursor = stateKey(state);
      for (let link = parent.get(cursor); link; link = parent.get(cursor)) {
        steps.push(link.op);
        cursor = link.prev;
      }
      return { status: 'found', steps: steps.reverse(), explored: parent.size };
    }
    for (const op of actions) {
      if (!applicable(state, op)) continue;
      const next = apply(state, op);
      const k = stateKey(next);
      if (parent.has(k)) continue;
      if (parent.size >= limits.maxStates)
        return {
          status: 'limit',
          explored: parent.size,
          reason: `more than ${limits.maxStates} states`,
        };
      parent.set(k, { prev: stateKey(state), op: op.label });
      queue.push(next);
    }
  }
  return { status: 'unsolvable', explored: parent.size };
}

export function checkPlan(
  domain: Domain,
  problem: Problem,
  limits: PlannerLimits = DEFAULT_LIMITS,
): PlanCheck {
  try {
    const { actions, rows } = ground(domain, problem, limits);
    return { grounding: rows, plan: search(actions, problem, limits) };
  } catch (error) {
    if (!(error instanceof LimitExceeded)) throw error;
    return {
      grounding: [],
      plan: { status: 'limit', explored: 0, reason: error.message },
    };
  }
}
