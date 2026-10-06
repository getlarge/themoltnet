/**
 * Score design runs against pre-registered requirements
 * (examples/<example>/required.json). A run passes only if it planned and its
 * plan satisfies every rule:
 *
 * 1. coverage: each required step occurs for each goal item
 * 2. order:    an item's steps occur in the listed order (earliest occurrences)
 * 3. owner:    every actor acting on an item is the one that claimed it
 * 4. sharing:  no produced object serves two items, and the planner finds no
 *              shared work (forcedAnalysis)
 * plus: no step uses a forbidden branch.
 *
 * A step belongs to the first goal item among its arguments; a step that names
 * no item belongs to the item its objects were first seen with.
 *
 *   pnpm exec tsx scripts/score-runs.ts <runs-dir> <label-prefix> [--json out.json]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Domain, Problem } from '../src/ir.js';
import { forcedAnalysis } from '../src/planner.js';

interface StepRule {
  id: string;
  match: string;
  exclude?: string;
}
interface Required {
  items: string[];
  steps: StepRule[];
  forbidden?: string;
  order: Array<[string, string]>;
  global_order: Array<[string, string]>;
  actor_type: string | null;
  produced_types: string[];
}
interface Run {
  status: string;
  domain?: Domain;
  problem?: Problem;
  plan?: { status: string; steps?: string[] };
}

const EXAMPLES = new URL('../examples/', import.meta.url).pathname;
const EXAMPLE_NAMES = [
  'issue-workflow-explicit',
  'docs-review-guided',
  'docs-review',
  'blocks-world',
];

export function scoreRun(
  run: Run,
  req: Required,
): { pass: boolean; reasons: string[] } {
  if (
    run.status !== 'planned' ||
    !run.plan?.steps ||
    !run.domain ||
    !run.problem
  )
    return { pass: false, reasons: [`no plan (${run.status})`] };
  const reasons: string[] = [];
  const typeOf = new Map(run.problem.objects.map((o) => [o.name, o.type]));
  const steps = run.plan.steps.map((label) => {
    const [action, ...args] = label.slice(1, -1).split(' ');
    return { action, args };
  });
  const matches = (rule: StepRule, action: string) =>
    new RegExp(rule.match, 'i').test(action) &&
    !(rule.exclude && new RegExp(rule.exclude, 'i').test(action));

  if (req.forbidden) {
    const re = new RegExp(req.forbidden, 'i');
    for (const s of steps)
      if (re.test(s.action)) reasons.push(`uses excluded branch ${s.action}`);
  }

  // Associate each step with an item. Agents serve many items, so they never
  // anchor an association: an object counts as an agent when its type or an
  // ancestor type names an agent role.
  const isActor = (o: string) =>
    !!req.actor_type && (typeOf.get(o) ?? '').includes(req.actor_type);
  const parentOf = new Map(run.domain.types.map((t) => [t.name, t.parent]));
  const isAgent = (o: string) => {
    for (let t: string | undefined = typeOf.get(o); t; t = parentOf.get(t))
      if (/agent|coder|reviewer|arm|robot/.test(t)) return true;
    return false;
  };
  const objectItem = new Map<string, string>();
  const owner = steps.map((s) => {
    const direct = s.args.find((a) => req.items.includes(a));
    const item =
      direct ??
      (req.items.length === 1
        ? req.items[0]
        : s.args
            .filter((a) => !isAgent(a))
            .map((a) => objectItem.get(a))
            .find(Boolean));
    if (item)
      for (const a of s.args)
        if (!req.items.includes(a) && !isAgent(a) && !objectItem.has(a))
          objectItem.set(a, item);
    return item;
  });

  // 1. coverage and 2. order, per item.
  const firstIndex = (item: string, rule: StepRule) =>
    steps.findIndex((s, i) => owner[i] === item && matches(rule, s.action));
  for (const item of req.items) {
    for (const rule of req.steps)
      if (firstIndex(item, rule) < 0)
        reasons.push(`${item}: no ${rule.id} step`);
    for (const [a, b] of req.order) {
      const ra = req.steps.find((r) => r.id === a);
      const rb = req.steps.find((r) => r.id === b);
      if (!ra || !rb) continue;
      const ia = firstIndex(item, ra);
      const ib = firstIndex(item, rb);
      if (ia >= 0 && ib >= 0 && ia > ib)
        reasons.push(`${item}: ${b} before ${a}`);
    }
  }
  for (const [a, b] of req.global_order) {
    const [ida, itema] = a.split(':');
    const [idb, itemb] = b.split(':');
    const ra = req.steps.find((r) => r.id === ida);
    const rb = req.steps.find((r) => r.id === idb);
    if (!ra || !rb) continue;
    const ia = firstIndex(itema, ra);
    const ib = firstIndex(itemb, rb);
    if (ia >= 0 && ib >= 0 && ia > ib) reasons.push(`${b} before ${a}`);
  }

  // 3. owner: the actor of the item's first step (its claim) does all its work.
  if (req.actor_type) {
    for (const item of req.items) {
      const own = steps.filter((_, i) => owner[i] === item);
      const claimant = own.flatMap((s) => s.args).find(isActor);
      for (const s of own)
        for (const a of s.args)
          if (isActor(a) && a !== claimant)
            reasons.push(
              `${item}: ${s.action} done by ${a}, claimed by ${claimant}`,
            );
    }
  }

  // 4. sharing: produced objects used for two items, and planner shared work.
  if (req.produced_types.length) {
    const usedBy = new Map<string, Set<string>>();
    steps.forEach((s, i) => {
      const item = owner[i];
      if (!item) return;
      for (const a of s.args) {
        const type = typeOf.get(a) ?? '';
        if (
          !req.produced_types.some((t) => type.includes(t)) ||
          /slot/.test(type)
        )
          continue;
        usedBy.set(a, (usedBy.get(a) ?? new Set()).add(item));
      }
    });
    for (const [obj, items] of usedBy)
      if (items.size > 1)
        reasons.push(`${obj} serves ${[...items].join(' and ')}`);
    const shared = forcedAnalysis(run.domain, run.problem, {
      maxGroundActions: 20_000,
      maxStates: 50_000,
    }).shared;
    for (const s of shared)
      reasons.push(`planner: ${s.action} shared by ${s.items.join(' and ')}`);
  }
  return { pass: reasons.length === 0, reasons: [...new Set(reasons)] };
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')
) {
  const [dir, prefix, flag, out] = process.argv.slice(2);
  const rows: Array<{
    label: string;
    example: string;
    pass: boolean;
    reasons: string[];
  }> = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.startsWith(`run-${prefix}`) && f.endsWith('.json'))
    .sort()) {
    const label = file.slice(4, -5);
    const example = EXAMPLE_NAMES.find((e) => label.includes(`-${e}-`));
    if (!example) continue;
    const req = JSON.parse(
      readFileSync(join(EXAMPLES, example, 'required.json'), 'utf8'),
    ) as Required;
    const run = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Run;
    const { pass, reasons } = scoreRun(run, req);
    rows.push({ label, example, pass, reasons });
    process.stdout.write(
      `${pass ? 'PASS' : 'fail'}  ${label.padEnd(34)} ${reasons.slice(0, 3).join(' | ')}\n`,
    );
  }
  if (flag === '--json' && out)
    writeFileSync(out, JSON.stringify(rows, null, 2));
}
