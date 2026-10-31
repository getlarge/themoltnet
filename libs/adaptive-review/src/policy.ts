import { RE2JS } from 're2js';
import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';

export const LANES = [
  'docs',
  'tests',
  'conventions',
  'security',
  'blast-radius',
  'performance',
  'complexity',
] as const;
export type Lane = (typeof LANES)[number];
const LaneSchema = Type.Union([
  Type.Literal('docs'),
  Type.Literal('tests'),
  Type.Literal('conventions'),
  Type.Literal('security'),
  Type.Literal('blast-radius'),
  Type.Literal('performance'),
  Type.Literal('complexity'),
]);

const Text = Type.String({ minLength: 1, maxLength: 2_000 });
const Id = Type.String({ pattern: '^[a-z][a-z0-9-]*$', maxLength: 80 });
const Globs = Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
  minItems: 1,
  maxItems: 64,
});
const Exclusions = Type.Optional(Globs);

export const ConventionRuleSchema = Type.Object(
  {
    id: Id,
    description: Text,
    paths: Globs,
    kind: Type.Union([Type.Literal('mechanical'), Type.Literal('semantic')]),
    source: Text,
  },
  { additionalProperties: false },
);
export type ConventionRule = Static<typeof ConventionRuleSchema>;

const CheckFields = {
  id: Id,
  ruleId: Id,
  detail: Text,
  paths: Globs,
  excludePaths: Exclusions,
};
export const MechanicalCheckSchema = Type.Union([
  Type.Object(
    { ...CheckFields, kind: Type.Literal('changed-path') },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...CheckFields,
      kind: Type.Literal('added-line'),
      pattern: Type.String({ minLength: 1, maxLength: 256 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...CheckFields,
      kind: Type.Literal('missing-companion'),
      companionPaths: Globs,
    },
    { additionalProperties: false },
  ),
]);
export type MechanicalCheck = Static<typeof MechanicalCheckSchema>;

export const AdaptivePolicySchema = Type.Object(
  {
    version: Type.Literal(1),
    lanes: Type.Array(LaneSchema, {
      minItems: 1,
      maxItems: LANES.length,
    }),
    rules: Type.Array(ConventionRuleSchema, { maxItems: 256 }),
    checks: Type.Array(MechanicalCheckSchema, { maxItems: 256 }),
    docs: Type.Optional(
      Type.Object({ config: Text }, { additionalProperties: false }),
    ),
    complexity: Type.Optional(
      Type.Object({ rubric: Text }, { additionalProperties: false }),
    ),
  },
  { additionalProperties: false },
);
export type AdaptivePolicy = Static<typeof AdaptivePolicySchema>;

/** v1 policy globs support literal segments, `*` within a segment, and `**`. */
export function validatePolicyGlob(pattern: string): void {
  if (
    pattern.startsWith('/') ||
    pattern.startsWith('./') ||
    pattern.includes('\\') ||
    pattern
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          (part.includes('**') && part !== '**') ||
          /[?![\]{}()]/.test(part),
      )
  ) {
    throw new Error(`invalid policy glob: ${pattern}`);
  }
}

function validateReference(path: string): void {
  if (
    path.startsWith('/') ||
    path.startsWith('./') ||
    path.includes('\\') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`invalid policy reference: ${path}`);
  }
}

/** Strictly validate the base-commit JSON before it affects routing. */
export function parseAdaptivePolicy(value: unknown): AdaptivePolicy {
  if (!Value.Check(AdaptivePolicySchema, value)) {
    throw new Error('invalid adaptive review policy schema');
  }
  if (new Set(value.lanes).size !== value.lanes.length) {
    throw new Error('adaptive review lanes must be unique');
  }
  const ruleIds = new Set<string>();
  for (const rule of value.rules) {
    if (ruleIds.has(rule.id))
      throw new Error(`duplicate policy rule: ${rule.id}`);
    ruleIds.add(rule.id);
    rule.paths.forEach(validatePolicyGlob);
  }
  const checkIds = new Set<string>();
  for (const check of value.checks) {
    if (checkIds.has(check.id))
      throw new Error(`duplicate policy check: ${check.id}`);
    checkIds.add(check.id);
    if (!ruleIds.has(check.ruleId)) {
      throw new Error(`policy check ${check.id} references an unknown rule`);
    }
    [...check.paths, ...(check.excludePaths ?? [])].forEach(validatePolicyGlob);
    if (check.kind === 'missing-companion') {
      check.companionPaths.forEach(validatePolicyGlob);
    }
    if (check.kind === 'added-line') {
      try {
        RE2JS.compile(check.pattern);
      } catch {
        throw new Error(`invalid policy pattern: ${check.id}`);
      }
    }
  }
  if (value.docs) validateReference(value.docs.config);
  if (value.complexity) validateReference(value.complexity.rubric);
  return value;
}

function matchesSegment(value: string, pattern: string): boolean {
  let valueIndex = 0;
  let patternIndex = 0;
  let starIndex = -1;
  let retryIndex = 0;
  while (valueIndex < value.length) {
    if (pattern[patternIndex] === value[valueIndex]) {
      valueIndex++;
      patternIndex++;
    } else if (pattern[patternIndex] === '*') {
      starIndex = patternIndex++;
      retryIndex = valueIndex;
    } else if (starIndex !== -1) {
      patternIndex = starIndex + 1;
      valueIndex = ++retryIndex;
    } else {
      return false;
    }
  }
  while (pattern[patternIndex] === '*') patternIndex++;
  return patternIndex === pattern.length;
}

export function matchesPolicyGlob(path: string, pattern: string): boolean {
  if (!pattern.includes('*')) return path === pattern;
  const segments = path.split('/');
  let reachable = Array<boolean>(segments.length + 1).fill(false);
  reachable[0] = true;
  for (const glob of pattern.split('/')) {
    const next = Array<boolean>(segments.length + 1).fill(false);
    if (glob === '**') {
      next[0] = reachable[0];
      for (let index = 1; index <= segments.length; index++) {
        next[index] = reachable[index] || next[index - 1];
      }
    } else {
      for (let index = 0; index < segments.length; index++) {
        if (reachable[index] && matchesSegment(segments[index], glob)) {
          next[index + 1] = true;
        }
      }
    }
    reachable = next;
  }
  return reachable[segments.length];
}

export function matchesPolicyPaths(
  path: string,
  paths: readonly string[],
  excludePaths: readonly string[] = [],
): boolean {
  return (
    paths.some((pattern) => matchesPolicyGlob(path, pattern)) &&
    !excludePaths.some((pattern) => matchesPolicyGlob(path, pattern))
  );
}
