/**
 * A small classical planner over the typed IR: STRIPS with typing and negative
 * preconditions, the fragment the stages are allowed to produce.
 *
 * It is a checker, not a production planner:
 *
 * - `relaxedReachability` ignores delete effects. A goal fact it cannot reach
 *   can never become true, so the problem is unsolvable; an action it never
 *   fires names the facts that are missing.
 * - `search` is greedy best-first search guided by the additive heuristic
 *   (h_add). It finds a valid plan quickly but not necessarily a shortest one.
 *   Pruning states with an infinite heuristic is sound, so an exhausted search
 *   proves unsolvability.
 * - `validatePlan` replays a plan step by step, for gold-plan tests.
 *
 * The grounding table explains a failure: an action with zero concrete
 * instances names the parameter type that has no objects.
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

export interface BlockedAction {
  action: string;
  /** The instance missing the fewest facts, and those facts. */
  example: string;
  missing: string[];
  /**
   * Missing facts that no action can produce for the first time: they must
   * come from the initial state. The others are produced only by actions that
   * are blocked too.
   */
  rootMissing: string[];
}

export interface Reachability {
  /** Positive goal facts that cannot become true even ignoring deletes. */
  unreachableGoals: string[];
  /** Actions with instances, none of which can ever fire. */
  blocked: BlockedAction[];
}

export type PlanResult =
  | { status: 'found'; steps: string[]; explored: number }
  | { status: 'unsolvable'; explored: number; reason: string }
  | { status: 'limit'; explored: number; reason: string };

export interface PlanCheck {
  grounding: GroundingRow[];
  reachability?: Reachability;
  plan: PlanResult;
}

export interface PlannerLimits {
  /** Maximum concrete actions before grounding stops. */
  maxGroundActions: number;
  /** Maximum distinct states the search may visit. */
  maxStates: number;
}

export const DEFAULT_LIMITS: PlannerLimits = {
  maxGroundActions: 20_000,
  maxStates: 100_000,
};

export const factKey = (predicate: string, args: string[]) =>
  `(${[predicate, ...args].join(' ')})`;

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
          factKey(
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

const initialState = (problem: Problem) =>
  new Set(problem.init.map((x) => factKey(x.predicate, x.args)));

const goalFacts = (problem: Problem) => ({
  pos: problem.goal
    .filter((x) => !x.negated)
    .map((x) => factKey(x.predicate, x.args)),
  neg: problem.goal
    .filter((x) => x.negated)
    .map((x) => factKey(x.predicate, x.args)),
});

/** Facts reachable when delete effects and negative preconditions are ignored. */
function relaxedClosure(state: Set<string>, actions: GroundAction[]) {
  const facts = new Set(state);
  const fired = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    actions.forEach((op, i) => {
      if (fired.has(i) || !op.pre.every((f) => facts.has(f))) return;
      fired.add(i);
      for (const f of op.add) {
        if (!facts.has(f)) {
          facts.add(f);
          changed = true;
        }
      }
    });
  }
  return { facts, fired };
}

export function relaxedReachability(
  actions: GroundAction[],
  problem: Problem,
): Reachability {
  const { facts, fired } = relaxedClosure(initialState(problem), actions);
  const unreachableGoals = goalFacts(problem).pos.filter((f) => !facts.has(f));
  const byAction = new Map<string, { label: string; missing: string[] }>();
  const firedActions = new Set<string>();
  actions.forEach((op, i) => {
    if (fired.has(i)) {
      firedActions.add(op.action);
      return;
    }
    const missing = op.pre.filter((f) => !facts.has(f));
    const best = byAction.get(op.action);
    if (!best || missing.length < best.missing.length)
      byAction.set(op.action, { label: op.label, missing });
  });
  // An action that needs a fact cannot produce it for the first time (an
  // agent's `idle` that the action deletes and re-adds), so it does not count.
  const producible = new Set(
    actions.flatMap((op) => op.add.filter((f) => !op.pre.includes(f))),
  );
  const blocked = [...byAction]
    .filter(([action]) => !firedActions.has(action))
    .map(([action, best]) => ({
      action,
      example: best.label,
      missing: best.missing,
      rootMissing: best.missing.filter((f) => !producible.has(f)),
    }));
  return { unreachableGoals, blocked };
}

/** Additive heuristic: sum of relaxed costs of the goal facts. */
function hAdd(state: Set<string>, actions: GroundAction[], goals: string[]) {
  const cost = new Map<string, number>();
  for (const f of state) cost.set(f, 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (const op of actions) {
      let c = 1;
      for (const f of op.pre) {
        const v = cost.get(f);
        if (v === undefined) {
          c = Infinity;
          break;
        }
        c += v;
      }
      if (c === Infinity) continue;
      for (const f of op.add) {
        const v = cost.get(f);
        if (v === undefined || c < v) {
          cost.set(f, c);
          changed = true;
        }
      }
    }
  }
  let h = 0;
  for (const g of goals) {
    const v = cost.get(g);
    if (v === undefined) return Infinity;
    h += v;
  }
  return h;
}

/** Binary min-heap on [h, g, sequence]. */
class Queue<T> {
  private items: Array<{ k: [number, number, number]; v: T }> = [];
  private less = (a: [number, number, number], b: [number, number, number]) =>
    a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
  get size() {
    return this.items.length;
  }
  push(k: [number, number, number], v: T) {
    const items = this.items;
    items.push({ k, v });
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(items[i].k, items[p].k)) break;
      [items[i], items[p]] = [items[p], items[i]];
      i = p;
    }
  }
  pop(): T | undefined {
    const items = this.items;
    if (!items.length) return undefined;
    const top = items[0].v;
    const last = items.pop();
    if (items.length && last) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.less(items[l].k, items[m].k)) m = l;
        if (r < items.length && this.less(items[r].k, items[m].k)) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m], items[i]];
        i = m;
      }
    }
    return top;
  }
}

const stateKey = (state: Set<string>) => [...state].sort().join('|');

export function search(
  actions: GroundAction[],
  problem: Problem,
  limits: PlannerLimits = DEFAULT_LIMITS,
): PlanResult {
  const goals = goalFacts(problem);
  const isGoal = (s: Set<string>) =>
    goals.pos.every((f) => s.has(f)) && !goals.neg.some((f) => s.has(f));
  const start = initialState(problem);
  const startKey = stateKey(start);
  const parent = new Map<string, { prev: string; op: string } | null>([
    [startKey, null],
  ]);
  const queue = new Queue<{ state: Set<string>; key: string; g: number }>();
  let sequence = 0;
  const h0 = hAdd(start, actions, goals.pos);
  if (h0 === Infinity)
    return {
      status: 'unsolvable',
      explored: 1,
      reason: 'a goal fact is unreachable even ignoring delete effects',
    };
  queue.push([h0, 0, sequence++], { state: start, key: startKey, g: 0 });
  for (let node = queue.pop(); node !== undefined; node = queue.pop()) {
    if (isGoal(node.state)) {
      const steps: string[] = [];
      let cursor = node.key;
      for (let link = parent.get(cursor); link; link = parent.get(cursor)) {
        steps.push(link.op);
        cursor = link.prev;
      }
      return { status: 'found', steps: steps.reverse(), explored: parent.size };
    }
    for (const op of actions) {
      if (!applicable(node.state, op)) continue;
      const next = apply(node.state, op);
      const key = stateKey(next);
      if (parent.has(key)) continue;
      if (parent.size >= limits.maxStates)
        return {
          status: 'limit',
          explored: parent.size,
          reason: `more than ${limits.maxStates} states`,
        };
      parent.set(key, { prev: node.key, op: op.label });
      const h = hAdd(next, actions, goals.pos);
      if (h === Infinity) continue; // dead end: the goal is unreachable from here
      queue.push([h, node.g + 1, sequence++], {
        state: next,
        key,
        g: node.g + 1,
      });
    }
  }
  return {
    status: 'unsolvable',
    explored: parent.size,
    reason: 'every reachable state was explored without reaching the goal',
  };
}

export type PlanValidation =
  | { valid: true; finalState: string[] }
  | { valid: false; step: number; reason: string };

/**
 * Replay a plan from the initial state. Each step is a ground action label,
 * e.g. `(stack arm b c)`. Use it to assert that intended plans work and that
 * known-bad plans are rejected by a generated domain.
 */
export function validatePlan(
  domain: Domain,
  problem: Problem,
  steps: string[],
  limits: PlannerLimits = DEFAULT_LIMITS,
): PlanValidation {
  const { actions } = ground(domain, problem, limits);
  const byLabel = new Map(actions.map((op) => [op.label, op]));
  let state = initialState(problem);
  for (const [i, label] of steps.entries()) {
    const op = byLabel.get(label);
    if (!op)
      return { valid: false, step: i, reason: `unknown action ${label}` };
    const missing = op.pre.filter((f) => !state.has(f));
    const blocking = op.neg.filter((f) => state.has(f));
    if (missing.length || blocking.length)
      return {
        valid: false,
        step: i,
        reason: [
          missing.length ? `missing ${missing.join(' ')}` : '',
          blocking.length ? `must be false: ${blocking.join(' ')}` : '',
        ]
          .filter(Boolean)
          .join('; '),
      };
    state = apply(state, op);
  }
  const goals = goalFacts(problem);
  const unmet = [
    ...goals.pos.filter((f) => !state.has(f)),
    ...goals.neg.filter((f) => state.has(f)).map((f) => `(not ${f})`),
  ];
  if (unmet.length)
    return {
      valid: false,
      step: steps.length,
      reason: `goal not reached: ${unmet.join(' ')}`,
    };
  return { valid: true, finalState: [...state].sort() };
}

export function checkPlan(
  domain: Domain,
  problem: Problem,
  limits: PlannerLimits = DEFAULT_LIMITS,
): PlanCheck {
  let grounded: ReturnType<typeof ground>;
  try {
    grounded = ground(domain, problem, limits);
  } catch (error) {
    if (!(error instanceof LimitExceeded)) throw error;
    return {
      grounding: [],
      plan: { status: 'limit', explored: 0, reason: error.message },
    };
  }
  const reachability = relaxedReachability(grounded.actions, problem);
  if (reachability.unreachableGoals.length)
    return {
      grounding: grounded.rows,
      reachability,
      plan: {
        status: 'unsolvable',
        explored: 0,
        reason: `goal facts can never become true: ${reachability.unreachableGoals.join(' ')}`,
      },
    };
  return {
    grounding: grounded.rows,
    reachability,
    plan: search(grounded.actions, problem, limits),
  };
}

export interface SharedWork {
  action: string;
  /** Goal items that can each reach their goal without their own instance. */
  items: string[];
}

export interface ForcedAnalysis {
  /** Action schemas the goal cannot be reached without. */
  forced: string[];
  /** Action schemas every plan can do without. */
  skippable: string[];
  /** Forced schemas that no single goal item needs its own instance of. */
  shared: SharedWork[];
}

/**
 * Which steps does the goal force? Remove each action schema and re-plan; a
 * schema the goal cannot do without is forced. Then, for goal items of the
 * same type, remove only the instances that mention one item: if every item
 * still reaches the goal, one item's step serves them all (work is shared).
 */
export function forcedAnalysis(
  domain: Domain,
  problem: Problem,
  limits: PlannerLimits = DEFAULT_LIMITS,
): ForcedAnalysis {
  const { actions } = ground(domain, problem, limits);
  const solvable = (ops: GroundAction[]) => search(ops, problem, limits).status;
  const typeOf = new Map(problem.objects.map((o) => [o.name, o.type]));
  const goalItems = [
    ...new Set(problem.goal.filter((g) => !g.negated).flatMap((g) => g.args)),
  ];
  const byType = new Map<string, string[]>();
  for (const item of goalItems) {
    const t = typeOf.get(item) ?? '';
    byType.set(t, [...(byType.get(t) ?? []), item]);
  }
  const peers = [...byType.values()].filter((items) => items.length > 1);
  const mentions = (op: GroundAction, item: string) =>
    op.label.slice(1, -1).split(' ').slice(1).includes(item);

  const result: ForcedAnalysis = { forced: [], skippable: [], shared: [] };
  for (const schema of domain.actions) {
    if (
      solvable(actions.filter((op) => op.action !== schema.name)) !==
      'unsolvable'
    ) {
      result.skippable.push(schema.name);
      continue;
    }
    result.forced.push(schema.name);
    for (const items of peers) {
      const verdicts = items.map((item) => {
        const own = actions.filter(
          (op) => op.action === schema.name && mentions(op, item),
        );
        if (!own.length) return null;
        return solvable(actions.filter((op) => !own.includes(op)));
      });
      if (
        verdicts.every((v) => v === 'found') &&
        verdicts.length === items.length
      )
        result.shared.push({ action: schema.name, items });
    }
  }
  return result;
}
