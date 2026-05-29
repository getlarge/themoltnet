/**
 * Phase-1 success-criteria authoring (assertions + side effects). Types are
 * declared locally so task-ui stays free of @moltnet/api-client; they are a
 * structural subset of the server's SuccessCriteria schema
 * (libs/tasks/src/success-criteria.ts). Gates, rubric, and minComposite are
 * intentionally out of scope for phase 1 (see issue #1267).
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

/** Side-effect requirements (UI shape). */
export interface SideEffectsForm {
  diaryEntryRequired: boolean;
  /** Comma/space-free tags; the UI collects them as a list. */
  diaryEntryTags: string[];
  /** Empty string = unset. */
  referencedEntries: string;
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

export interface BuiltSuccessCriteria {
  version: 1;
  assertions?: SuccessCriteriaAssertion[];
  sideEffects?: SuccessCriteriaSideEffects;
}

export const EMPTY_SIDE_EFFECTS: SideEffectsForm = {
  diaryEntryRequired: false,
  diaryEntryTags: [],
  referencedEntries: '',
};

/** Whether `op` uses the `value` field at all (`exists` ignores it). */
export function opUsesValue(op: AssertionOp): boolean {
  return op !== 'exists';
}

/** Whether `op` uses the second `max` bound (`in-range` only). */
export function opUsesMax(op: AssertionOp): boolean {
  return op === 'in-range';
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
  assertions: AssertionRow[],
  sideEffects: SideEffectsForm,
): BuiltSuccessCriteria | undefined {
  const validAssertions = assertions.filter(
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

  const refs = sideEffects.referencedEntries.trim();
  const builtSideEffects: SuccessCriteriaSideEffects = {};
  if (sideEffects.diaryEntryRequired)
    builtSideEffects.diaryEntryRequired = true;
  if (sideEffects.diaryEntryTags.length > 0) {
    builtSideEffects.diaryEntryTags = sideEffects.diaryEntryTags;
  }
  if (refs !== '' && !Number.isNaN(Number(refs))) {
    builtSideEffects.referencedEntries = Number(refs);
  }
  const hasSideEffects = Object.keys(builtSideEffects).length > 0;

  if (builtAssertions.length === 0 && !hasSideEffects) return undefined;

  return {
    version: 1,
    ...(builtAssertions.length > 0 ? { assertions: builtAssertions } : {}),
    ...(hasSideEffects ? { sideEffects: builtSideEffects } : {}),
  };
}
