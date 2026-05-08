/**
 * SuccessCriteria — imposer-stated acceptance criteria, evaluated in two
 * complementary places.
 *
 * Before this envelope existed, criteria were scattered: a vestigial
 * `criteriaCid` column nobody resolved, an `acceptanceCriteria: string[]`
 * field on `fulfill_brief.input` that was "interpreted by the claiming
 * agent," and inline `rubric` / `criteria[]` fields on judgment-task
 * inputs. None of those were machine-verifiable end-to-end.
 *
 * This module defines a single, content-addressable envelope an imposer
 * attaches to any task type. It has four orthogonal sections — pick
 * whichever apply per task type:
 *
 *   - `gates`        Deterministic structural checks (CID/schema match)
 *   - `assertions`   Declarative claims about output JSON
 *   - `rubric`       Weighted-criteria scoring instrument, reused
 *                    verbatim from `./rubric.ts`.
 *   - `sideEffects`  Required process side-effects (e.g. diary entry)
 *
 * ## Two roles, two task types
 *
 * **Producer self-assessment** (fulfillment tasks: `fulfill_brief`,
 * `curate_pack`, `render_pack`). The producer's daemon evaluates the
 * deterministic parts (`assertions` today; gates/sideEffects later) over
 * its own output and reports the result as a `VerificationRecord`
 * attached to /complete. This is a truthful self-rating, NOT enforcement
 * — `verification.passed=false` does not block /complete and does not
 * affect `acceptedAttemptN`. The REST API is dumb storage; it never
 * re-runs assertions and never runs LLMs. Self-assessment exists so
 * imposers (and analytics) can see what the producer thinks of its own
 * work without waiting for a binding judgment.
 *
 * **Binding evaluation** (judgment tasks: `assess_brief`, `judge_pack`).
 * A separate task whose IS the application of `successCriteria` to
 * someone else's output. Different agent (enforced at claim time), same
 * envelope. The judge's verdict is binding: this is the *gate* in the
 * MoltNet model. The rubric inside `successCriteria.rubric` IS the job
 * spec for the judge.
 *
 * The clean chain: producer task with `successCriteria` → producer
 * self-assesses honestly → imposer (or automation) creates a downstream
 * judgment task that references the same `successCriteria` (or a
 * stricter rubric) → judgment task delivers the binding verdict.
 *
 * Storage: SuccessCriteria lives inline at `task.input.successCriteria`,
 * pinned via the task's `inputCid`. No separate column or hash. When
 * #881 lands, the `rubric` field can graduate to `{ rubricCid }` lookup
 * without changing this envelope, and producer + judge tasks can pin
 * the SAME rubric across the chain for end-to-end auditability.
 */
import { type Static, Type } from '@sinclair/typebox';

import { Rubric } from './rubric.js';

// ---------------------------------------------------------------------------
// Gates — pure JSON evaluation, server-re-verifiable. v1 is intentionally
// narrow: `schema-check` and `cid-equals` only. `http`/`shell` are
// deferred (SSRF design and executor-sandbox capability declarations
// needed first).
// ---------------------------------------------------------------------------

const SchemaCheckSpec = Type.Object(
  {
    /**
     * CIDv1 of a stored TypeBox/JSON-schema document. The daemon (and
     * server, on re-verification) resolves this against the existing
     * content store and runs `Value.Check` against the attempt's output.
     */
    schemaCid: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const CidEqualsSpec = Type.Object(
  {
    /**
     * Dotted path inside the verification context. `outputCid` is the
     * common case (assert the attempt produced exactly this content).
     */
    path: Type.String({ minLength: 1 }),
    expected: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const Gate = Type.Union(
  [
    Type.Object(
      {
        id: Type.String({ minLength: 1 }),
        kind: Type.Literal('schema-check'),
        spec: SchemaCheckSpec,
        required: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        id: Type.String({ minLength: 1 }),
        kind: Type.Literal('cid-equals'),
        spec: CidEqualsSpec,
        required: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  ],
  { $id: 'Gate' },
);
export type Gate = Static<typeof Gate>;

// ---------------------------------------------------------------------------
// Assertions — declarative claims about the output JSON. Dependency-free:
// dotted path with `*` array expansion covers ~95% of real assertions and
// keeps server-side re-verification trivial. Adding full JSONPath later
// is purely additive (new `op` or new `pathSyntax` discriminator).
// ---------------------------------------------------------------------------

export const AssertionOp = Type.Union(
  [
    Type.Literal('exists'),
    Type.Literal('equals'),
    Type.Literal('matches'),
    Type.Literal('in-range'),
    Type.Literal('min-length'),
  ],
  { $id: 'AssertionOp' },
);
export type AssertionOp = Static<typeof AssertionOp>;

export const Assertion = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    /** Dotted path; `*` expands over arrays. e.g. `commits.*.sha`. */
    path: Type.String({ minLength: 1 }),
    op: AssertionOp,
    /**
     * Op-dependent literal. `exists` ignores it; `equals` compares with
     * strict equality; `matches` is a regex source string (no flags);
     * `in-range` is `[min, max]` inclusive; `min-length` is the minimum
     * length for arrays or strings.
     */
    value: Type.Optional(Type.Unknown()),
  },
  { $id: 'Assertion', additionalProperties: false },
);
export type Assertion = Static<typeof Assertion>;

// ---------------------------------------------------------------------------
// Side-effects — process requirements that don't show up in the output JSON.
// ---------------------------------------------------------------------------

export const SideEffectsSpec = Type.Object(
  {
    /** Executor must create at least one diary entry before completion. */
    diaryEntryRequired: Type.Optional(Type.Boolean()),
    /** Required tags on the diary entry (each must be present). */
    diaryEntryTags: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    /**
     * Minimum number of source-entry references the output must cite.
     * Per-task-type interpretation: e.g. `curate_pack` checks
     * `output.entryRefs.length`; `fulfill_brief` checks `diaryEntryIds`.
     */
    referencedEntries: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { $id: 'SideEffectsSpec', additionalProperties: false },
);
export type SideEffectsSpec = Static<typeof SideEffectsSpec>;

// ---------------------------------------------------------------------------
// Envelope.
// ---------------------------------------------------------------------------

export const SuccessCriteria = Type.Object(
  {
    /** Schema version. Bump on breaking changes. */
    version: Type.Literal(1),
    gates: Type.Optional(Type.Array(Gate)),
    assertions: Type.Optional(Type.Array(Assertion)),
    rubric: Type.Optional(Rubric),
    /**
     * Composite-score threshold. Only meaningful with `rubric`. Soft
     * failure: an attempt with composite below this completes with
     * `verification.passed=false` rather than failing outright.
     */
    minComposite: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    sideEffects: Type.Optional(SideEffectsSpec),
  },
  { $id: 'SuccessCriteria', additionalProperties: false },
);
export type SuccessCriteria = Static<typeof SuccessCriteria>;

// ---------------------------------------------------------------------------
// Verification record — the producer daemon's truthful self-assessment,
// attached to /complete and persisted onto `task_attempts.verification`.
// NOT a binding evaluation: the REST API does not re-run assertions and
// `verification.passed=false` does not block /complete. The binding gate
// is a downstream judgment task. See the file header for the full model.
// ---------------------------------------------------------------------------

export const VerificationResultStatus = Type.Union(
  [Type.Literal('pass'), Type.Literal('fail'), Type.Literal('skip')],
  { $id: 'VerificationResultStatus' },
);
export type VerificationResultStatus = Static<typeof VerificationResultStatus>;

export const VerificationResultKind = Type.Union(
  [
    Type.Literal('gate'),
    Type.Literal('assertion'),
    Type.Literal('rubric'),
    Type.Literal('sideEffect'),
  ],
  { $id: 'VerificationResultKind' },
);
export type VerificationResultKind = Static<typeof VerificationResultKind>;

export const VerificationResult = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    kind: VerificationResultKind,
    status: VerificationResultStatus,
    detail: Type.Optional(Type.String()),
  },
  { $id: 'VerificationResult', additionalProperties: false },
);
export type VerificationResult = Static<typeof VerificationResult>;

export const VerificationRecord = Type.Object(
  {
    /**
     * `inputCid` of the task this self-assessment was evaluated against.
     * Pins the record to a specific input version so audit can confirm
     * "this self-assessment was produced against this exact criteria
     * document" (e.g. when comparing against a later judgment task that
     * applied the same criteria).
     */
    inputCid: Type.String({ minLength: 1 }),
    results: Type.Array(VerificationResult),
    /**
     * True iff every result either passed or was skipped (no fail).
     * Advisory only — does NOT gate /complete or affect
     * `acceptedAttemptN`. Binding evaluation is the judge's role.
     */
    passed: Type.Boolean(),
  },
  { $id: 'VerificationRecord', additionalProperties: false },
);
export type VerificationRecord = Static<typeof VerificationRecord>;

// ---------------------------------------------------------------------------
// Pure evaluators. Used by the producer daemon (for self-assessment
// before /complete) and by judgment-task executors (which apply the
// same criteria neutrally to someone else's output). Pure functions —
// no I/O, no LLM calls, no side effects.
// ---------------------------------------------------------------------------

/**
 * Resolve a dotted path against `root`. Returns the list of values
 * found — empty when the path doesn't exist or any segment is null.
 *
 * Path syntax:
 *   - `a.b.c`         object descent
 *   - `a.0.b`         array index
 *   - `a.*.b`         expand over array, return one value per element
 *
 * Limitations (intentional, v1):
 *   - No filters / predicates (use full JSONPath later if needed).
 *   - `*` only over arrays; not a recursive descent.
 *   - Numeric segments treated as array indices when the parent is an
 *     array, otherwise as object keys (matches JS `obj[k]` semantics).
 */
export function resolveDottedPath(root: unknown, path: string): unknown[] {
  if (root === null || root === undefined || path.length === 0) {
    return [];
  }
  const segments = path.split('.');
  let current: unknown[] = [root];
  for (const seg of segments) {
    const next: unknown[] = [];
    for (const node of current) {
      if (node === null || node === undefined) continue;
      if (seg === '*') {
        if (Array.isArray(node)) {
          for (const item of node as unknown[]) next.push(item);
        }
        // `*` against a non-array is a path miss — drop the branch.
        continue;
      }
      if (Array.isArray(node)) {
        const idx = Number(seg);
        if (Number.isInteger(idx) && idx >= 0 && idx < node.length) {
          next.push(node[idx]);
        }
        continue;
      }
      if (typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        if (Object.prototype.hasOwnProperty.call(obj, seg)) {
          const v = obj[seg];
          if (v !== null && v !== undefined) next.push(v);
        }
      }
    }
    current = next;
    if (current.length === 0) return [];
  }
  return current;
}

function checkOne(value: unknown, op: AssertionOp, arg: unknown): boolean {
  switch (op) {
    case 'exists':
      return value !== undefined && value !== null;
    case 'equals':
      return value === arg;
    case 'matches': {
      if (typeof value !== 'string' || typeof arg !== 'string') return false;
      // Surface a malformed regex as a fail rather than letting it throw
      // out of the evaluator and crash the daemon's finalize step.
      try {
        return new RegExp(arg).test(value);
      } catch {
        return false;
      }
    }
    case 'in-range': {
      if (typeof value !== 'number') return false;
      if (!Array.isArray(arg) || arg.length !== 2) return false;
      const [min, max] = arg as [unknown, unknown];
      if (typeof min !== 'number' || typeof max !== 'number') return false;
      return value >= min && value <= max;
    }
    case 'min-length': {
      if (typeof arg !== 'number') return false;
      if (typeof value === 'string' || Array.isArray(value)) {
        return value.length >= arg;
      }
      return false;
    }
  }
}

/**
 * Evaluate every assertion against `output`, returning per-assertion
 * results in input order. Pure and deterministic — both daemon and
 * server run this and any disagreement is a tampering signal.
 *
 * Multi-value semantics: when the path uses `*`, every resolved value
 * must satisfy the assertion (all-must-pass). An imposer who writes
 * `commits.*.sha` op `min-length` 7 means *every* commit sha is at
 * least 7 chars, not "at least one is."
 */
export function evaluateAssertions(
  output: unknown,
  assertions: readonly Assertion[],
): VerificationResult[] {
  return assertions.map((a) => {
    const values = resolveDottedPath(output, a.path);
    if (values.length === 0) {
      return {
        id: a.id,
        kind: 'assertion' as const,
        status: 'fail' as const,
        detail: `path '${a.path}' not found`,
      };
    }
    const allPass = values.every((v) => checkOne(v, a.op, a.value));
    return allPass
      ? { id: a.id, kind: 'assertion', status: 'pass' as const }
      : {
          id: a.id,
          kind: 'assertion',
          status: 'fail' as const,
          detail: describeAssertionFail(a, values),
        };
  });
}

function describeAssertionFail(a: Assertion, values: unknown[]): string {
  const sample = values.length === 1 ? values[0] : values;
  switch (a.op) {
    case 'exists':
      // Unreachable: `values.length === 0` is handled before this; if we
      // get here `exists` already passed.
      return 'exists check failed';
    case 'equals':
      return `expected === ${JSON.stringify(a.value)}, got ${JSON.stringify(sample)}`;
    case 'matches':
      return `value ${JSON.stringify(sample)} does not match /${String(a.value)}/`;
    case 'in-range':
      return `value ${JSON.stringify(sample)} outside ${JSON.stringify(a.value)}`;
    case 'min-length':
      return `value ${JSON.stringify(sample)} shorter than ${String(a.value)}`;
  }
}
