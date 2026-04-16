# Gap-test design principles

A gap-test is an eval scenario where the model performs poorly without
project-specific context and well with it. The delta between the two
scores proves the context pack's value.

These principles were derived from real failures during the MoltNet
context pack dogfooding session (April 2026). The anti-patterns at the
bottom are things that actually happened and produced fabricated or
inflated baselines.

## The five principles

### 1. The trap is invisible

The task scaffolding tempts the model toward the wrong answer. TODOs
should be placed where the intuitive (wrong) solution goes. The task
should read as a straightforward implementation request.

**Good:** TODOs inside a transaction callback, when the correct answer
is to move the operation outside the callback.

**Bad:** "Implement X, keeping in mind that Y is important."

### 2. Reference code shows only the wrong path

Fixtures demonstrate the intuitive (incorrect) pattern. If you provide
a sibling file that uses the same API differently, it should NOT explain
why — the model must notice the difference itself.

**Good:** A `packs_get.go` that uses single type assertion (wrong
pattern for multi-status responses).

**Bad:** A fixture with `// CORRECT: use type switch` comments.

### 3. The answer isn't in the fixtures

Over 70% of the score should require knowledge that cannot be derived
from the provided code. If reading the fixtures reveals both the problem
and the solution, you've given away the answer.

**Test:** Have someone read only task.md + fixtures. If they can score

> 70% without domain knowledge, the scenario leaks.

### 4. Criteria require articulation, not just correct code

At least 40% of the score should require the model to explain WHY in
notes.md — naming specific systems, describing failure modes, or
identifying gaps in defensive checks. Correct code alone should score
≤60%.

**Good:** "notes.md names both DBOS and Drizzle as separate backends
and describes the rollback failure mode" (25 points).

**Bad:** "Uses a type switch instead of single assertion" (observable
from fixtures, no domain knowledge needed).

### 5. The task doesn't mention the gotcha

Don't say "be careful about X", "note that Y uses Z", or "the server
returns HTTP 204." If the task tells the model what to watch for, it
will watch for it. The model either knows the trap exists or it doesn't.

**Good:** "Fill in the handler so the diary row is inserted and the
owner grant workflow is started."

**Bad:** "The server returns HTTP 204 (No Content) on successful
deletion, so handle both response types."

## Anti-patterns that produce fake baselines

### Estimating instead of measuring

"I expect ~35% baseline" is a projection, not a measurement. The author
knows the trap and overestimates its difficulty. Run the eval binary and
read the score.

### Single-run baselines

One run can be an outlier. `repository-tenant-scope-bypass` scored 100%,
70%, 55%, 70% across four runs — a 45-point spread. Run at least 2 for
a gate check, 4 for reporting.

### Criteria that test code structure

"Uses a type switch" is observable from fixtures. "Names both DBOS and
Drizzle as separate backends" requires domain knowledge. Structure
criteria are free points that inflate baselines.

### Task that narrates the fix

"Debug why session-authenticated users can't access team-scoped
resources" is fine. "Add resolveTeamContext to the session path" is the
answer. The former requires diagnosis; the latter is copy-paste.

### Criteria context that spoils the answer

The `context` field in criteria.json is judge-only, but it shapes how
the author designs criteria. If the context says "the correct timestamp
is 1774560400011", the criteria will test for that exact value — and the
fixture's \_journal.json already shows the sequence. The scenario becomes
a lookup.

### Showing both patterns in fixtures

If fixture A shows the wrong pattern and fixture B shows the right
pattern, the model just diffs them. The scenario tests reading
comprehension, not domain knowledge.

## Gold standard

`evals/moltnet-practices/dbos-after-commit/` — 20% baseline.

Study it before writing new scenarios. It follows all five principles.
