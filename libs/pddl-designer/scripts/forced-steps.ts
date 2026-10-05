/**
 * Which steps does the goal force? For each action schema, remove it and ask
 * the planner whether the goal is still reachable. A schema the goal cannot do
 * without is forced; any other schema is skippable in every plan.
 *
 * With --per-object NAME, also remove only the instances of each schema that
 * mention NAME (for example one issue) and check again: if the goal is still
 * reachable, that object can reach its goal without its own instance of the
 * step, i.e. it borrows another object's work.
 *
 *   pnpm exec tsx scripts/forced-steps.ts run.json [--per-object issue-102]
 */
import { readFileSync } from 'node:fs';

import type { Domain, Problem } from '../src/ir.js';
import { ground, search } from '../src/planner.js';

const [file, flag, objectName] = process.argv.slice(2);
const run = JSON.parse(readFileSync(file, 'utf8')) as {
  domain: Domain;
  problem: Problem;
};
const { domain, problem } = run;
const { actions } = ground(domain, problem);

const solvable = (ops: typeof actions) =>
  search(ops, problem, { maxGroundActions: 20_000, maxStates: 100_000 }).status;

process.stdout.write(`baseline: ${solvable(actions)}` + '\n');
for (const schema of domain.actions) {
  const without = actions.filter((op) => op.action !== schema.name);
  const verdict = solvable(without);
  const label =
    verdict === 'found'
      ? 'skippable'
      : verdict === 'unsolvable'
        ? 'FORCED'
        : 'undecided';
  let perObject = '';
  if (flag === '--per-object' && objectName) {
    const mentions = actions.filter(
      (op) =>
        op.action === schema.name &&
        op.label.split(/[ ()]/).includes(objectName),
    );
    if (mentions.length) {
      const v = solvable(actions.filter((op) => !mentions.includes(op)));
      perObject =
        v === 'found'
          ? `  ${objectName} reaches its goal WITHOUT its own ${schema.name}`
          : v === 'unsolvable'
            ? `  ${objectName} needs its own ${schema.name}`
            : '  undecided';
    }
  }
  process.stdout.write(
    `  ${schema.name.padEnd(34)} ${label.padEnd(10)}${perObject}` + '\n',
  );
}
