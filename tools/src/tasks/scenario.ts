/**
 * scenario.ts — read an eval scenario dir and project it into the shape
 * the `run_eval` / `judge_eval_variant` task input schemas expect.
 *
 * Eval scenarios live as triplets under `evals/<skill>/scenario-<n>/`:
 *
 *   - `task.md`        free-form Markdown brief; becomes `scenario.prompt`
 *                      on a `run_eval` task input
 *   - `criteria.json`  `{ checklist: [{ name, description, max_score }] }`
 *                      compiled into a `successCriteria.rubric`
 *   - `eval.json`      `{ mode: "vitro" | "vivo" }`. Today the field is
 *                      recorded only for human reference; the task runtime
 *                      has no `mode` discriminator yet. Future wiring will
 *                      surface it on the task or in trust-level routing.
 *
 * Helpers here are intentionally minimal — composition belongs to the
 * imposer scripts (`run-eval.ts`, `judge-eval-variant.ts`) which import
 * `buildRubricFromCriteria` + `resolveSkillBinding` and assemble the
 * full task input themselves.
 *
 * Will be deleted once #1135 (server-side task templates) lands and the
 * scenario dir becomes a template upload rather than a one-off file-read
 * on the imposer side.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import type { ContextRef, Rubric } from '@moltnet/tasks';

export type EvalMode = 'vitro' | 'vivo';

export interface ScenarioCriterion {
  /** Free-text name; slugified into `rubric.criteria[].id`. */
  name: string;
  /** What the judge should check. Becomes `rubric.criteria[].description`. */
  description: string;
  /** Pre-normalized weight; we normalize to fractions summing to 1.0. */
  max_score: number;
}

export interface ScenarioCriteria {
  checklist: ScenarioCriterion[];
}

export interface Scenario {
  /** Path to the scenario dir (absolute) — used for error messages. */
  scenarioPath: string;
  /** Last path segment, e.g. `scenario-0`. Used as `rubricId` namespace. */
  scenarioId: string;
  /** Full text of `task.md`. Fed directly as `RunEvalInput.scenario.prompt`. */
  taskPrompt: string;
  /** Parsed `criteria.json`. */
  criteria: ScenarioCriteria;
  /** Parsed `eval.json.mode`. */
  evalMode: EvalMode;
}

/**
 * Read a scenario dir. Throws clearly if any of the three required
 * files is missing or malformed — fail-loud is the right default for
 * an imposer that's about to spend tokens.
 *
 * Relative scenario paths are resolved against `repoRoot` (the caller
 * usually passes `git rev-parse --show-toplevel`). pnpm scripts run
 * from `tools/`, so a relative path like `evals/legreffier/scenario-0`
 * cannot be resolved against `process.cwd()`.
 */
export function readScenario(scenarioPath: string, repoRoot: string): Scenario {
  const absPath = isAbsolute(scenarioPath)
    ? scenarioPath
    : join(repoRoot, scenarioPath);

  let taskPrompt: string;
  let criteriaRaw: string;
  let evalRaw: string;
  try {
    taskPrompt = readFileSync(join(absPath, 'task.md'), 'utf8');
  } catch (err) {
    throw new Error(
      `Scenario ${absPath} is missing task.md: ${asMessage(err)}`,
    );
  }
  try {
    criteriaRaw = readFileSync(join(absPath, 'criteria.json'), 'utf8');
  } catch (err) {
    throw new Error(
      `Scenario ${absPath} is missing criteria.json: ${asMessage(err)}`,
    );
  }
  try {
    evalRaw = readFileSync(join(absPath, 'eval.json'), 'utf8');
  } catch (err) {
    throw new Error(
      `Scenario ${absPath} is missing eval.json: ${asMessage(err)}`,
    );
  }

  const criteria = JSON.parse(criteriaRaw) as ScenarioCriteria;
  if (!Array.isArray(criteria.checklist) || criteria.checklist.length === 0) {
    throw new Error(
      `Scenario ${absPath}/criteria.json must have a non-empty "checklist" array`,
    );
  }
  for (const [i, c] of criteria.checklist.entries()) {
    if (typeof c.name !== 'string' || c.name.length === 0) {
      throw new Error(`criteria.json checklist[${i}].name must be non-empty`);
    }
    if (typeof c.description !== 'string' || c.description.length === 0) {
      throw new Error(
        `criteria.json checklist[${i}].description must be non-empty`,
      );
    }
    if (typeof c.max_score !== 'number' || c.max_score <= 0) {
      throw new Error(
        `criteria.json checklist[${i}].max_score must be a positive number`,
      );
    }
  }

  const evalCfg = JSON.parse(evalRaw) as { mode?: string };
  if (evalCfg.mode !== 'vitro' && evalCfg.mode !== 'vivo') {
    throw new Error(
      `Scenario ${absPath}/eval.json must declare "mode": "vitro" | "vivo" (got ${JSON.stringify(evalCfg.mode)})`,
    );
  }

  return {
    scenarioPath: absPath,
    scenarioId: absPath.split('/').filter(Boolean).pop() ?? 'scenario',
    taskPrompt,
    criteria,
    evalMode: evalCfg.mode,
  };
}

/**
 * Build a `Rubric` from a scenario's `criteria.json`.
 *
 * Weight normalization: `max_score` values are summed across the
 * checklist and each criterion's weight is `max_score / total`. Rounded
 * to 6 decimals for canonical equality across `run_eval` invocations
 * (the judge's async validator demands byte-identical `successCriteria`
 * across variant tasks; rounding eliminates FP drift between consecutive
 * arithmetic paths that happen to be different in different runs).
 *
 * The criterion id is slugified from `name` so it's safe inside JSON
 * paths and stable across runs. The `description` is preserved verbatim
 * — that's the prose the judge reads.
 *
 * All criteria are scored as `llm_checklist` (binary pass/fail with
 * per-claim assertions). The agentskills.io eval methodology and the
 * #823 dogfooding plan both call for binary tool-call assertions before
 * semantic scoring. Other scoring modes can be wired later by reading a
 * per-criterion `scoring` field on the scenario; today every scenario in
 * `evals/legreffier/` is binary and the field is implied.
 */
export function buildRubricFromCriteria(
  criteria: ScenarioCriteria,
  rubricId: string,
  rubricVersion = 'v1',
): Rubric {
  const totalMaxScore = criteria.checklist.reduce(
    (acc, c) => acc + c.max_score,
    0,
  );
  if (totalMaxScore <= 0) {
    throw new Error('Scenario criteria max_score sum must be positive');
  }

  const rubricCriteria = criteria.checklist.map((c) => ({
    id: slugify(c.name),
    description: c.description,
    weight: round6(c.max_score / totalMaxScore),
    scoring: 'llm_checklist' as const,
  }));

  // FP drift can leave the rounded sum at 0.9999999 or 1.0000001 after
  // independent rounding. Re-normalize the last weight to absorb the
  // delta so the rubric's "weights sum to 1" invariant holds exactly.
  const sumExceptLast = rubricCriteria
    .slice(0, -1)
    .reduce((acc, c) => acc + c.weight, 0);
  rubricCriteria[rubricCriteria.length - 1].weight = round6(1 - sumExceptLast);

  return {
    rubricId,
    version: rubricVersion,
    criteria: rubricCriteria,
  };
}

/**
 * Read a skill's `SKILL.md` and project it into a `kind: 'skill'`
 * binding for `RunEvalInput.context[]`. The slug is preserved verbatim
 * — the daemon mounts the skill at
 * `/workspace/.moltnet/skills/<slug>/SKILL.md` inside the VM.
 *
 * Skills live at `.claude/skills/<slug>/SKILL.md` relative to the repo
 * root by convention. Callers may override the search root for testing.
 */
export function resolveSkillBinding(
  slug: string,
  repoRoot: string,
): ContextRef {
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    throw new Error(
      `Skill slug "${slug}" must match /^[a-zA-Z0-9_-]+$/ (alphanumeric + dashes/underscores) per ContextRef schema`,
    );
  }
  const skillPath = join(repoRoot, '.claude', 'skills', slug, 'SKILL.md');
  let content: string;
  try {
    content = readFileSync(skillPath, 'utf8');
  } catch (err) {
    throw new Error(
      `Could not read skill "${slug}" at ${skillPath}: ${asMessage(err)}`,
    );
  }
  return { slug, binding: 'skill', content };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
