/**
 * Deterministic cross-stage checks. Each stage's schema is validated by the
 * daemon and the stage parser; these checks cover what a schema cannot:
 * references between stages, arity, type compatibility, and planning-specific
 * hazards found in practice (an action whose parameter type has no objects
 * can never run; a fact no action deletes can be reused forever).
 *
 * Errors make a stage result unusable and trigger a correction attempt.
 * Warnings are passed to the refine stage as hints and kept in the run record.
 */
import type {
  ActionDef,
  Atom,
  Literal,
  ObjectDef,
  Parameter,
  PredicateDef,
  ProblemResult,
  TypeDef,
} from './ir.js';

export type Severity = 'error' | 'warning';
export interface Issue {
  severity: Severity;
  path: string;
  message: string;
  /** Stable identifier for hints that callers filter, e.g. `unlinked-parameters`. */
  code?: string;
}

/** Hints kept in the run record for reviewers but not sent to the refine stage. */
export const REVIEW_ONLY_CODES = new Set(['unlinked-parameters']);

const ROOT_TYPE = 'object';

const err = (path: string, message: string): Issue => ({
  severity: 'error',
  path,
  message,
});
const warn = (path: string, message: string): Issue => ({
  severity: 'warning',
  path,
  message,
});

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

function duplicates(names: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const name of names) (seen.has(name) ? dup : seen).add(name);
  return [...dup];
}

/** Type name → parent name (undefined parent means the root `object`). */
function parentMap(types: TypeDef[]): Map<string, string> {
  return new Map(types.map((t) => [t.name, t.parent ?? ROOT_TYPE]));
}

/** True when `type` equals `ancestor` or inherits from it. */
export function isSubtype(
  types: TypeDef[],
  type: string,
  ancestor: string,
): boolean {
  if (ancestor === ROOT_TYPE) return true;
  const parents = parentMap(types);
  let current: string | undefined = type;
  for (let depth = 0; current && depth <= types.length; depth++) {
    if (current === ancestor) return true;
    current = parents.get(current);
  }
  return false;
}

export function checkTypes(types: TypeDef[]): Issue[] {
  const issues: Issue[] = [];
  const names = new Set(types.map((t) => t.name));
  for (const name of duplicates(types.map((t) => t.name)))
    issues.push(err(`types/${name}`, 'duplicate type name'));
  types.forEach((t, i) => {
    if (t.name === ROOT_TYPE)
      issues.push(
        err(`types/${i}`, '`object` is the implicit root type; omit it'),
      );
    if (t.parent && t.parent !== ROOT_TYPE && !names.has(t.parent))
      issues.push(err(`types/${t.name}`, `parent ${t.parent} is not defined`));
  });
  const parents = parentMap(types);
  for (const t of types) {
    const seen = new Set<string>();
    let current: string | undefined = t.name;
    while (current && current !== ROOT_TYPE) {
      if (seen.has(current)) {
        issues.push(err(`types/${t.name}`, 'type hierarchy has a cycle'));
        break;
      }
      seen.add(current);
      current = parents.get(current);
    }
  }
  return issues;
}

function checkParameters(
  path: string,
  parameters: Parameter[],
  typeNames: Set<string>,
): Issue[] {
  const issues: Issue[] = [];
  for (const name of duplicates(parameters.map((p) => p.name)))
    issues.push(err(path, `parameter ${name} is declared twice`));
  for (const p of parameters)
    if (p.type !== ROOT_TYPE && !typeNames.has(p.type))
      issues.push(err(path, `parameter ${p.name} has unknown type ${p.type}`));
  return issues;
}

export function checkPredicates(
  types: TypeDef[],
  predicates: PredicateDef[],
): Issue[] {
  const typeNames = new Set(types.map((t) => t.name));
  const issues: Issue[] = [];
  for (const name of duplicates(predicates.map((p) => p.name)))
    issues.push(err(`predicates/${name}`, 'duplicate predicate name'));
  for (const p of predicates)
    issues.push(
      ...checkParameters(`predicates/${p.name}`, p.parameters, typeNames),
    );
  return issues;
}

/**
 * Check one atom against the predicate signatures. `argType` returns the type
 * of an argument (an action parameter or a problem object), or undefined when
 * the argument is unknown in that scope.
 */
function checkAtom(
  path: string,
  atom: Atom | Literal,
  predicates: Map<string, PredicateDef>,
  types: TypeDef[],
  argType: (arg: string) => string | undefined,
  scope: string,
): Issue[] {
  const signature = predicates.get(atom.predicate);
  if (!signature) return [err(path, `unknown predicate ${atom.predicate}`)];
  if (signature.parameters.length !== atom.args.length)
    return [
      err(
        path,
        `${atom.predicate} takes ${signature.parameters.length} argument(s), got ${atom.args.length}`,
      ),
    ];
  const issues: Issue[] = [];
  atom.args.forEach((arg, i) => {
    const type = argType(arg);
    const expected = signature.parameters[i].type;
    if (type === undefined)
      issues.push(err(path, `${arg} is not a declared ${scope}`));
    else if (!isSubtype(types, type, expected))
      issues.push(
        err(
          path,
          `${atom.predicate} argument ${i + 1} expects ${expected}, got ${arg} of type ${type}`,
        ),
      );
  });
  return issues;
}

export function checkActions(
  types: TypeDef[],
  predicates: PredicateDef[],
  actions: ActionDef[],
): Issue[] {
  const typeNames = new Set(types.map((t) => t.name));
  const signatures = new Map(predicates.map((p) => [p.name, p]));
  const issues: Issue[] = [];
  for (const name of duplicates(actions.map((a) => a.name)))
    issues.push(err(`actions/${name}`, 'duplicate action name'));
  for (const a of actions) {
    const base = `actions/${a.name}`;
    issues.push(...checkParameters(base, a.parameters, typeNames));
    const params = new Map(a.parameters.map((p) => [p.name, p.type]));
    const atom = (kind: string) => (x: Atom | Literal, i: number) =>
      checkAtom(
        `${base}/${kind}/${i}`,
        x,
        signatures,
        types,
        (arg) => params.get(arg),
        'parameter of this action',
      );
    a.preconditions.forEach((x, i) => issues.push(...atom('pre')(x, i)));
    a.addEffects.forEach((x, i) => issues.push(...atom('add')(x, i)));
    a.deleteEffects.forEach((x, i) => issues.push(...atom('del')(x, i)));
    if (a.addEffects.length === 0 && a.deleteEffects.length === 0)
      issues.push(warn(base, 'action has no effects'));
    issues.push(...unlinkedParameters(a));
  }
  issues.push(...permanentFacts(predicates, actions));
  return issues;
}

/**
 * A predicate that some action adds and some action requires, but no action
 * deletes, stays true forever once added. That is how a stale approval or an
 * old commit gets reused by a later step. Usually a missing delete effect.
 */
export function permanentFacts(
  predicates: PredicateDef[],
  actions: ActionDef[],
): Issue[] {
  const added = new Set(
    actions.flatMap((a) => a.addEffects.map((x) => x.predicate)),
  );
  const deleted = new Set(
    actions.flatMap((a) => a.deleteEffects.map((x) => x.predicate)),
  );
  const required = new Set(
    actions.flatMap((a) =>
      a.preconditions.filter((x) => !x.negated).map((x) => x.predicate),
    ),
  );
  return predicates
    .filter(
      (p) => added.has(p.name) && required.has(p.name) && !deleted.has(p.name),
    )
    .map((p) =>
      warn(
        `predicates/${p.name}`,
        `no action deletes ${p.name}: once added it stays true. Fine for a permanent milestone; a problem if a later step should not be able to reuse it`,
      ),
    );
}

export function checkProblem(
  types: TypeDef[],
  predicates: PredicateDef[],
  actions: ActionDef[],
  problem: ProblemResult,
): Issue[] {
  const typeNames = new Set(types.map((t) => t.name));
  const signatures = new Map(predicates.map((p) => [p.name, p]));
  const objects = new Map(problem.objects.map((o) => [o.name, o.type]));
  const issues: Issue[] = [];
  for (const name of duplicates(problem.objects.map((o) => o.name)))
    issues.push(err(`objects/${name}`, 'duplicate object name'));
  for (const o of problem.objects)
    if (!typeNames.has(o.type))
      issues.push(err(`objects/${o.name}`, `unknown type ${o.type}`));
  const atom = (kind: string) => (x: Atom | Literal, i: number) =>
    checkAtom(
      `${kind}/${i}`,
      x,
      signatures,
      types,
      (arg) => objects.get(arg),
      'object',
    );
  problem.init.forEach((x, i) => issues.push(...atom('init')(x, i)));
  problem.goal.forEach((x, i) => issues.push(...atom('goal')(x, i)));
  issues.push(...ungroundableActions(types, actions, problem.objects));
  return issues;
}

/**
 * Objects cannot be created by actions, so an action whose parameter type has
 * no object of that type (or a subtype) can never be applied.
 */
export function ungroundableActions(
  types: TypeDef[],
  actions: ActionDef[],
  objects: ObjectDef[],
): Issue[] {
  const issues: Issue[] = [];
  for (const a of actions) {
    const empty = a.parameters.filter(
      (p) => !objects.some((o) => isSubtype(types, o.type, p.type)),
    );
    if (empty.length)
      issues.push(
        err(
          `actions/${a.name}`,
          `no object can fill ${empty.map((p) => `${p.name} - ${p.type}`).join(', ')}; declare at least one object of that type (actions cannot create objects)`,
        ),
      );
  }
  return issues;
}

/**
 * Parameters that no precondition connects. If `run-tests(?c, ?w)` only
 * requires `(busy ?c)` and `(assigned ?w ?i)`, nothing says the worktree is
 * the coder's own, so any busy coder may test any worktree. That is sometimes
 * intended (any arm may pick up any block), so this is a hint for the refine
 * stage, not an error.
 */
export function unlinkedParameters(action: ActionDef): Issue[] {
  const parent = new Map(action.parameters.map((p) => [p.name, p.name]));
  const find = (x: string): string => {
    const up = parent.get(x) ?? x;
    if (up === x) return x;
    const root = find(up);
    parent.set(x, root);
    return root;
  };
  const used = new Set<string>();
  for (const atom of action.preconditions) {
    const params = atom.args.filter((arg) => parent.has(arg));
    params.forEach((arg) => used.add(arg));
    for (const arg of params.slice(1)) parent.set(find(arg), find(params[0]));
  }
  const issues: Issue[] = [];
  const typeOf = new Map(action.parameters.map((p) => [p.name, p.type]));
  const unused = action.parameters.filter((p) => !used.has(p.name));
  for (const p of unused)
    issues.push({
      ...warn(
        `actions/${action.name}`,
        `${p.name} - ${p.type} appears in no precondition, so the planner may pick any ${p.type}`,
      ),
      code: 'unlinked-parameters',
    });
  const groups = new Map<string, string[]>();
  for (const name of used) {
    const root = find(name);
    groups.set(root, [...(groups.get(root) ?? []), name]);
  }
  if (groups.size > 1) {
    const listed = [...groups.values()].map(
      (names) =>
        '{' + names.map((n) => `${n} - ${typeOf.get(n)}`).join(', ') + '}',
    );
    issues.push({
      ...warn(
        `actions/${action.name}`,
        `no precondition links ${listed.join(' and ')}: any combination may be chosen. Add a precondition that ties them if only a specific one may act`,
      ),
      code: 'unlinked-parameters',
    });
  }
  return issues;
}
