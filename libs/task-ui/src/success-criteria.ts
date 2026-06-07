/**
 * Success-criteria authoring (rubric + required evidence). Types are
 * declared locally so task-ui stays free of @moltnet/api-client; they are a
 * structural subset of the server's SuccessCriteria schema
 * (libs/tasks/src/success-criteria.ts).
 */

export type AssertionOp =
  | 'exists'
  | 'equals'
  | 'matches'
  | 'in-range'
  | 'min-length';

export const ASSERTION_OPS: AssertionOp[] = [
  'exists',
  'equals',
  'matches',
  'in-range',
  'min-length',
];

export type RubricScoringMode = 'boolean' | 'llm_score' | 'llm_checklist';

export const RUBRIC_SCORING_MODES: RubricScoringMode[] = [
  'boolean',
  'llm_score',
  'llm_checklist',
];

export interface RubricCriterionRow {
  name: string;
  weightPercent: string;
  scoring: RubricScoringMode;
  description: string;
}

export interface RubricForm {
  rubricId: string;
  version: string;
  preamble: string;
  minCompositePercent: string;
  criteria: RubricCriterionRow[];
}

/** A single assertion row in the editor (UI shape, pre-serialization). */
export interface AssertionRow {
  /** Dotted path into the output; `*` expands over arrays. */
  path: string;
  op: AssertionOp;
  /** Raw text the user typed for the op's value (interpreted per op). */
  value: string;
  /** Second bound for `in-range` (value holds the min, max holds the max). */
  max?: string;
}

export interface EvidenceRequirementsForm {
  requirePrUrl: boolean;
  minCommits: string;
  requireDiaryEntry: boolean;
  diaryEntryTags: string[];
  referencedEntries: string;
  requireOutputBody: boolean;
  customAssertions: AssertionRow[];
}

export interface SuccessCriteriaAssertion {
  id: string;
  path: string;
  op: AssertionOp;
  value?: unknown;
}

export interface SuccessCriteriaSideEffects {
  diaryEntryRequired?: boolean;
  diaryEntryTags?: string[];
  referencedEntries?: number;
}

export interface SuccessCriteriaRubricCriterion {
  id: string;
  description: string;
  weight: number;
  scoring: RubricScoringMode;
}

export interface SuccessCriteriaRubric {
  rubricId: string;
  version: string;
  preamble?: string;
  criteria: SuccessCriteriaRubricCriterion[];
}

export interface BuiltSuccessCriteria {
  version: 1;
  assertions?: SuccessCriteriaAssertion[];
  rubric?: SuccessCriteriaRubric;
  minComposite?: number;
  sideEffects?: SuccessCriteriaSideEffects;
}

export const EMPTY_EVIDENCE_REQUIREMENTS: EvidenceRequirementsForm = {
  requirePrUrl: false,
  minCommits: '',
  requireDiaryEntry: false,
  diaryEntryTags: [],
  referencedEntries: '',
  requireOutputBody: false,
  customAssertions: [],
};

export const DEFAULT_RUBRIC_CRITERION_DESCRIPTION =
  'Pass when the implementation is minimal, follows existing patterns, includes focused tests, and reports any validation that could not be run. Fail when it changes unrelated files, weakens existing behavior, or claims verification without evidence.';

export const EMPTY_RUBRIC_FORM: RubricForm = {
  rubricId: '',
  version: 'v1',
  preamble: '',
  minCompositePercent: '',
  criteria: [],
};

export interface RubricTemplate {
  id: string;
  label: string;
  rubric: RubricForm;
}

export const RUBRIC_TEMPLATES: RubricTemplate[] = [
  {
    id: 'implementation-task',
    label: 'Implementation task',
    rubric: {
      rubricId: 'implementation-task',
      version: 'v1',
      preamble:
        'Evaluate whether the task was implemented correctly, narrowly, and with enough validation evidence.',
      minCompositePercent: '85',
      criteria: [
        {
          name: 'implementation_quality',
          weightPercent: '40',
          scoring: 'llm_score',
          description: DEFAULT_RUBRIC_CRITERION_DESCRIPTION,
        },
        {
          name: 'test_coverage',
          weightPercent: '30',
          scoring: 'llm_score',
          description:
            'Pass when tests or focused validation cover the changed behavior. Fail when risky behavior changes without direct verification.',
        },
        {
          name: 'scope_control',
          weightPercent: '30',
          scoring: 'boolean',
          description:
            'Pass when the work stays inside the requested scope and preserves unrelated behavior. Fail when it rewrites or relaxes unrelated systems.',
        },
      ],
    },
  },
  {
    id: 'pr-complexity-binary-v1',
    label: 'PR review',
    rubric: {
      rubricId: 'pr-complexity-binary-v1',
      version: 'v1',
      preamble:
        'Evaluate whether a pull request is reviewable, well-scoped, and backed by useful evidence.',
      minCompositePercent: '90',
      criteria: [
        {
          name: 'cognitive_load',
          weightPercent: '20',
          scoring: 'boolean',
          description:
            'Pass when the change is easy to review from the diff and description. Fail when reviewers must infer intent or untangle unrelated edits.',
        },
        {
          name: 'blast_radius',
          weightPercent: '20',
          scoring: 'boolean',
          description:
            'Pass when affected modules and behavior are clear and bounded. Fail when shared contracts change without migration or compatibility notes.',
        },
        {
          name: 'test_coverage_delta',
          weightPercent: '20',
          scoring: 'boolean',
          description:
            'Pass when new or existing checks cover the changed behavior. Fail when validation is missing for user-visible or shared logic.',
        },
        {
          name: 'security_surface',
          weightPercent: '20',
          scoring: 'boolean',
          description:
            'Pass when auth, secret, input, and dependency risks are unchanged or explicitly handled. Fail when the PR broadens risk silently.',
        },
        {
          name: 'reviewer_orientation',
          weightPercent: '20',
          scoring: 'boolean',
          description:
            'Pass when the PR explains why the change exists, what changed, and how it was verified. Fail when evidence is vague or missing.',
        },
      ],
    },
  },
  {
    id: 'pr-security-v1',
    label: 'Security review',
    rubric: {
      rubricId: 'pr-security-v1',
      version: 'v1',
      preamble:
        'Evaluate security-sensitive behavior and require concrete evidence for every pass or fail.',
      minCompositePercent: '95',
      criteria: [
        {
          name: 'injection_safety',
          weightPercent: '15',
          scoring: 'llm_checklist',
          description:
            'Check user-controlled strings, query construction, command execution, and template rendering for injection paths.',
        },
        {
          name: 'authz_integrity',
          weightPercent: '20',
          scoring: 'llm_checklist',
          description:
            'Check authentication, authorization, team scoping, and object ownership boundaries.',
        },
        {
          name: 'secret_hygiene',
          weightPercent: '15',
          scoring: 'llm_checklist',
          description:
            'Check that secrets are not logged, committed, exposed to clients, or passed to untrusted tools.',
        },
        {
          name: 'input_validation',
          weightPercent: '20',
          scoring: 'llm_checklist',
          description:
            'Check runtime validation, error handling, bounds, and rejected malformed input.',
        },
        {
          name: 'safe_failure_modes',
          weightPercent: '30',
          scoring: 'llm_score',
          description:
            'Score whether failures deny by default, preserve auditability, and avoid partial privileged side effects.',
        },
      ],
    },
  },
  {
    id: 'research-report',
    label: 'Research/report',
    rubric: {
      rubricId: 'research-report',
      version: 'v1',
      preamble:
        'Evaluate whether the report is grounded, honest about uncertainty, and useful for the next decision.',
      minCompositePercent: '80',
      criteria: [
        {
          name: 'grounding',
          weightPercent: '35',
          scoring: 'llm_checklist',
          description:
            'Pass claims only when they cite concrete commands, sources, files, or observations.',
        },
        {
          name: 'negative_space',
          weightPercent: '25',
          scoring: 'llm_score',
          description:
            'Score whether limitations, unknowns, failed checks, and alternative explanations are explicit.',
        },
        {
          name: 'actionability',
          weightPercent: '25',
          scoring: 'llm_score',
          description:
            'Score whether the output supports a concrete next decision or implementation step.',
        },
        {
          name: 'evidence_quality',
          weightPercent: '15',
          scoring: 'llm_score',
          description:
            'Score whether evidence is specific enough for another agent or human to audit.',
        },
      ],
    },
  },
  {
    id: 'blank-custom-rubric',
    label: 'Blank custom rubric',
    rubric: {
      rubricId: 'custom-rubric',
      version: 'v1',
      preamble: '',
      minCompositePercent: '',
      criteria: [
        {
          name: 'quality',
          weightPercent: '100',
          scoring: 'llm_score',
          description: DEFAULT_RUBRIC_CRITERION_DESCRIPTION,
        },
      ],
    },
  },
];

/** Whether `op` uses the `value` field at all (`exists` ignores it). */
export function opUsesValue(op: AssertionOp): boolean {
  return op !== 'exists';
}

/** Whether `op` uses the second `max` bound (`in-range` only). */
export function opUsesMax(op: AssertionOp): boolean {
  return op === 'in-range';
}

export function normalizeCriterionId(value: string): string {
  let normalized = '';
  let pendingSeparator = false;

  for (const char of value.toLowerCase()) {
    const code = char.charCodeAt(0);
    const isAsciiLetter = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;

    if (isAsciiLetter || isDigit) {
      if (pendingSeparator && normalized.length > 0) {
        normalized += '_';
      }
      normalized += char;
      pendingSeparator = false;
      continue;
    }

    if (normalized.length > 0) {
      pendingSeparator = true;
    }
  }

  return normalized;
}

function hasRubricCriterionInput(row: RubricCriterionRow): boolean {
  return (
    normalizeCriterionId(row.name).length > 0 &&
    row.description.trim().length > 0 &&
    row.weightPercent.trim().length > 0
  );
}

function percentToUnit(value: string): number | undefined {
  const n = Number(value.trim());
  if (!Number.isFinite(n)) return undefined;
  return n / 100;
}

export function getRubricWeightSummary(rubric: RubricForm): {
  totalPercent: number;
  error: string | null;
} {
  const criteria = rubric.criteria.filter(hasRubricCriterionInput);
  const totalPercent = criteria.reduce(
    (sum, criterion) => sum + Number(criterion.weightPercent.trim()),
    0,
  );
  const hasInvalidWeight = criteria.some((criterion) => {
    const n = Number(criterion.weightPercent.trim());
    return !Number.isFinite(n) || n < 0 || n > 100;
  });
  if (criteria.length === 0) return { totalPercent: 0, error: null };
  if (hasInvalidWeight) {
    return { totalPercent, error: 'Rubric weights must be between 0 and 100.' };
  }
  if (Math.abs(totalPercent - 100) > 0.001) {
    return {
      totalPercent,
      error: `Rubric weights must sum to 100% (currently ${totalPercent.toFixed(
        1,
      )}%).`,
    };
  }
  return { totalPercent, error: null };
}

export function validateRubricForm(rubric: RubricForm): string | null {
  const criteria = rubric.criteria.filter(hasRubricCriterionInput);
  if (criteria.length === 0) return null;
  if (!rubric.rubricId.trim()) return 'Rubric ID is required.';
  if (!rubric.version.trim()) return 'Rubric version is required.';
  return getRubricWeightSummary(rubric).error;
}

function coerceAssertionValue(row: AssertionRow): unknown {
  switch (row.op) {
    case 'exists':
      return undefined;
    case 'in-range': {
      const min = Number(row.value);
      const max = Number(row.max ?? '');
      return [min, max];
    }
    case 'min-length':
      return Number(row.value);
    case 'equals': {
      // Numbers/booleans round-trip naturally; otherwise keep the string.
      const n = Number(row.value);
      if (row.value.trim() !== '' && !Number.isNaN(n)) return n;
      if (row.value === 'true') return true;
      if (row.value === 'false') return false;
      return row.value;
    }
    case 'matches':
    default:
      return row.value;
  }
}

/**
 * Assemble a SuccessCriteria document from the editor's rows. Returns undefined
 * when nothing was authored (the common case — the server still injects its
 * default submit gate). Drops assertion rows with a blank path.
 */
export function buildSuccessCriteria(
  rubric: RubricForm = EMPTY_RUBRIC_FORM,
  evidence: EvidenceRequirementsForm = EMPTY_EVIDENCE_REQUIREMENTS,
): BuiltSuccessCriteria | undefined {
  const evidenceAssertions: AssertionRow[] = [
    ...(evidence.requirePrUrl
      ? [
          {
            path: 'pullRequestUrl',
            op: 'matches' as const,
            value: '^https://github\\.com/.+/.+/pull/[0-9]+$',
          },
        ]
      : []),
    ...(evidence.minCommits.trim()
      ? [
          {
            path: 'commits',
            op: 'min-length' as const,
            value: evidence.minCommits.trim(),
          },
        ]
      : []),
    ...(evidence.requireOutputBody
      ? [{ path: 'body', op: 'exists' as const, value: '' }]
      : []),
    ...evidence.customAssertions,
  ];

  const validAssertions = evidenceAssertions.filter(
    (row) => row.path.trim().length > 0,
  );
  const builtAssertions: SuccessCriteriaAssertion[] = validAssertions.map(
    (row, index) => {
      const assertion: SuccessCriteriaAssertion = {
        id: `a${index + 1}`,
        path: row.path.trim(),
        op: row.op,
      };
      if (opUsesValue(row.op)) assertion.value = coerceAssertionValue(row);
      return assertion;
    },
  );

  const refs = evidence.referencedEntries.trim();
  const diaryEntryTags = evidence.diaryEntryTags;
  const builtSideEffects: SuccessCriteriaSideEffects = {};
  if (evidence.requireDiaryEntry) builtSideEffects.diaryEntryRequired = true;
  if (diaryEntryTags.length > 0) {
    builtSideEffects.diaryEntryTags = diaryEntryTags;
  }
  if (refs !== '' && !Number.isNaN(Number(refs))) {
    builtSideEffects.referencedEntries = Number(refs);
  }
  const hasSideEffects = Object.keys(builtSideEffects).length > 0;
  const rubricCriteria = rubric.criteria.filter(hasRubricCriterionInput);
  const builtRubric =
    rubricCriteria.length > 0
      ? {
          rubricId: rubric.rubricId.trim(),
          version: rubric.version.trim(),
          ...(rubric.preamble.trim()
            ? { preamble: rubric.preamble.trim() }
            : {}),
          criteria: rubricCriteria.map((criterion) => ({
            id: normalizeCriterionId(criterion.name),
            description: criterion.description.trim(),
            weight: percentToUnit(criterion.weightPercent) ?? 0,
            scoring: criterion.scoring,
          })),
        }
      : undefined;
  const minComposite = percentToUnit(rubric.minCompositePercent);

  if (builtAssertions.length === 0 && !hasSideEffects && !builtRubric)
    return undefined;

  return {
    version: 1,
    ...(builtAssertions.length > 0 ? { assertions: builtAssertions } : {}),
    ...(builtRubric ? { rubric: builtRubric } : {}),
    ...(builtRubric && minComposite !== undefined ? { minComposite } : {}),
    ...(hasSideEffects ? { sideEffects: builtSideEffects } : {}),
  };
}
