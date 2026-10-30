# Attempt and subagent checkpoint investigation

A checkpoint stores a document's full current value as a new base instead of
another delta (a change applied to that base). This reduces the revisions needed
to reconstruct the current value in memory; it does not shorten the remote
commit log.

This change adopts checkpoints only for pending subagents. Once a child has 32
stored deltas, its next counter update writes a base if `output` is still null.
Ordinary 30-turn children are unchanged, and final output remains a delta.
Attempt checkpointing stays disabled: copying an entire completed attempt can
exceed the 1 MiB commit ceiling even when its original deltas fit.

This partially addresses issue #2834. Attempts without a positive turn limit can
still retain arbitrarily long delta tails. Resolving that requires a policy that
preserves admission of currently valid commits, including large documents and
transactions that write several documents. No production slowdown or latency
improvement has been established by this investigation.

## Reproduce

From the repository root, with dependencies installed, run the representation
and executor correctness tests:

```sh
NX_DAEMON=false NX_NO_CLOUD=true pnpm exec nx run @themoltnet/pi-runtime:test --skipNxCache -- src/checkpoint-policy.test.ts src/durable-executor.test.ts
```

To also produce the measurement matrix:

```sh
CHECKPOINT_BENCH=1 NX_DAEMON=false NX_NO_CLOUD=true pnpm exec nx run @themoltnet/pi-runtime:test --skipNxCache -- src/checkpoint-policy.test.ts
```

The opt-in
[checkpoint policy test](../../libs/pi-runtime/src/checkpoint-policy.test.ts)
writes `/tmp/checkpoint-policy-results.json` and
`/tmp/checkpoint-child-results.json`. It runs without Docker, credentials or
network. Ordinary test runs exercise correctness and skip the timing matrix. Use
a quiet machine and repeat runs before comparing timings. The recorded sample
used Node 24.14.1 and `@earendil-works/pi-durable` 1.4.0.

## Lifetime and terminal paths

The owning definitions and mutations are in
[`durable-executor.ts`](../../libs/pi-runtime/src/durable-executor.ts). Both
families are session-scoped, current-only documents. A current-only document
retains revisions from its latest base for current-value reads. Neither family
is retired when a Pi task finishes. Reopening the store retains completed and
incomplete family members; a continuation may need the parent's attempt result.

| Family                                | Updates                                                                                                                                                                     | Terminal boundary                                                                                                                                                                                  | Actual bound                                                                                                                                                                                                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attempt, keyed by task/attempt        | Initial seed; environment once; one turn update per distinct assistant tool round; bash timeout counters; invalid-final-message/reminder counters; first submission; result | `result !== null` covers persisted success and settled failures (including budget exhaustion and provider verdicts). Exceptions/cancellation before result persistence do not cross this boundary. | A positive configured `maxTurns` bounds distinct tool rounds, but is not an exact bound on all document changes. Absent/nonpositive means unlimited. Restarting the same key preserves counters; a new attempt uses another key. No global retained revision bound.        |
| Subagent, keyed by child conversation | Initial state; one increment per admitted generation; first valid output                                                                                                    | `output !== null` covers valid submission only. Exhaustion, missing output, or invalid submission can leave it null.                                                                               | The child cap is the configured positive parent limit, otherwise 30. At most 30 turn changes plus one successful output change for an ordinary child, plus its initial base. A configured larger limit increases this bound. Session-wide child count is not bounded here. |

Provider retry machinery does not independently increment the attempt turn
counter. The `lastToolRound` comparison prevents replayed notifications for the
same assistant round from spending another turn. A completed-result recovery
returns the stored result before preparing the environment or running a model.
These behaviors remain covered by the executor recovery suite.

`prepare` accepts an arbitrary `JsonObject` checkpoint; the Gondolin adapter
currently supplies a small marker/token object. The 32 KiB environment fixture
is an adapter stress case, not a measurement of typical Gondolin markers. The
seed also includes a per-model/tool usage baseline whose size depends on prior
session activity. Freeform submission summaries have no schema `maxLength`;
inline artifacts have individual limits, but those do not imply a small whole
attempt document. See
[`freeform.ts`](../../libs/tasks/src/task-types/freeform.ts).

## What a checkpoint changes

Pi's `session/transaction.js` calls the predicate only for a changed document.
`CheckpointInfo.deltasSinceBase` excludes that candidate change. Therefore
`>= 32` allows 32 stored deltas and replaces the next change with a base. A
no-op neither appends a commit nor advances/resets that count.

For children created under the adopted policy, this permits at most 32 pending
deltas and at most 33 after the separate output delta. It is not a migration of
existing histories: completed children are untouched. A pending child with an
older, longer tail is checkpointed on its next counter update; an output update
without another counter update deliberately skips the checkpoint.

The base replaces that document's delta in the same atomic transaction.
`storage/memory.js` replaces the revision list with the new base for
current-only documents; it does not retire the document or delete remote
commits. `ApiDurableStorage.open` still reads every immutable commit, verifies
its sequence/checksum and applies it. The tests use this adapter rather than a
separate replay implementation.

The probes assert latest values, exact threshold/reset, no-op behavior,
completed result and turn recovery, immutable history preservation, and read
counts after reopening mixed delta/base histories. The conversation service also
reads a mixed attempt history without changing messages or writing to the log.
Existing conformance/fencing/idempotency tests run unchanged.

## Measured representation costs

Each attempt fixture has the executor's counters and seed shape, one unchanged
environment payload, distinct tool-round updates, a submission, and a result
containing the same output. Each child fixture has only `turns` and `output`.
The attempt candidates are disabled, completion-only, and completion plus
thresholds of 32 or 64 stored deltas. Child fixtures also measure the adopted
`pending32` policy: checkpoint only while output is null, at 32 stored deltas.
Completion and periodic-plus-completion remain comparison candidates; neither is
the adopted policy.

One local sample, 500 turns, 32 KiB environment and output for attempts and 32
KiB output for children. The child case simulates an explicitly increased cap;
it does not represent the default 30-turn child lifecycle. Serialized commit
payload bytes are summed across the entire history, not the size of one commit:

| Family / policy                    | Active delta tail before submission | Final delta tail | Serialized commit payload bytes | Commits | Reopen transport read calls |
| ---------------------------------- | ----------------------------------: | ---------------: | ------------------------------: | ------: | --------------------------: |
| Attempt / disabled                 |                                 500 |              502 |                         184,162 |     503 |                         252 |
| Attempt / completion               |                                 500 |                0 |                         249,982 |     503 |                         252 |
| Attempt / periodic 32 + completion |                                   5 |                0 |                         745,007 |     503 |                         252 |
| Attempt / periodic 64 + completion |                                  45 |                0 |                         480,992 |     503 |                         252 |
| Child / disabled                   |                                 500 |              501 |                         102,031 |     502 |                         251 |
| Child / completion                 |                                 500 |                0 |                         102,036 |     502 |                         251 |
| Child / periodic 32 + completion   |                                   5 |                0 |                         102,141 |     502 |                         251 |
| Child / pending 32 (adopted)       |                                   5 |                6 |                         102,136 |     502 |                         251 |
| Child / periodic 64 + completion   |                                  45 |                0 |                         102,085 |     502 |                         251 |

The fixture transport returns two commits per read. These are actual calls
through the adapter to an in-process mock, **not HTTP requests or production
page sizes**. Read counts are deliberately identical across policies. Download
payload bytes would grow with these serialized writes; no cursor skips history.

The matrix also runs 30 turns and smaller payloads (2 KiB attempt environment
and output; 128-byte child output). The 30-turn synthetic child fixture starts
with a separate zero-turn base and ends at 30 deltas under all compared
policies. The executor combines initialization with its first turn, so an
ordinary 30-turn child has 29 pending deltas. Neither case triggers a checkpoint
before output. Completion-checkpoint candidates reduce that tail to zero; the
adopted pending-only policy keeps the output as one final delta. For long
attempts, periodic copying amplifies writes substantially while completion alone
leaves the active tail unchanged.

The JSON separates 1,000 warm Session snapshots, 1,000 direct storage document
reads, one cold Session snapshot after replay, and full adapter reopen. In this
sample warm reads were around 0.2–0.3 ms per **1,000** snapshots for long runs
across policies. Direct storage reads fell from hundreds of milliseconds to
roughly 1 ms per 1,000 for the completion-checkpoint candidates. The adopted
child policy retained six final deltas and took about 4.3 ms per 1,000. Warm
Session trackers already cache state; the direct-read difference is not an
agent-turn speedup. Full reopen still processes all commits, and its single-run
timings are noisy.

CPU fields measure process CPU during mutation plus warm/direct reads. Heap
fields are unforced-GC, process-wide samples that include the fixture's retained
immutable log and other test allocations. They must not be interpreted as
per-document retained heap. Public `deltasSinceBase + 1` gives retained revision
depth for these current-only fixtures. `retainedContentBytes` sums serialized
content from the latest base onward as a reproducible memory proxy; it excludes
JS object overhead and indexes. No isolated heap allocation or production CPU
claim is made.

## Commit-size counterexample and decision

The regression test follows reachable executor ordering:

1. Persist a freeform submission with a summary just under 1 MiB.
2. Persist the completed result containing that same summary in a later commit.
3. Compare the disabled-policy delta with a completion-policy full base.

Both original deltas fit under 1 MiB. The base repeats submission and result and
exceeds the limit even with a 128-byte environment marker. The test measures the
same `{ format: 'pi-durable.v1', writes }` envelope used by
[`runtime-stores.ts`](../../libs/runtime-session-service/src/runtime-stores.ts)
for rejection. The in-process transport does not itself enforce the HTTP size
limit; the test asserts serialized sizes on either side of it. A document-only
predicate also cannot inspect unrelated writes sharing its aggregate commit.

### Adopted child policy

The executor checkpoints only when `output === null` and at least 32 deltas are
already stored. A completion-only policy would leave active and exhausted
children's tails unchanged. Pending counter updates instead provide a safe
boundary: `beforeRequest` commits only the tiny child counter document, with no
final output to copy. The pinned implementation adds seven serialized bytes per
base compared with its counter delta, including across counter digit boundaries.
The attempt admission counterexample therefore does not apply to this boundary.

The threshold of 32 is the smallest measured candidate above the default 30-turn
cap. It leaves ordinary children unchanged while bounding the tail of longer
configured runs. A threshold of 64 retains twice the pending tail without
benefiting ordinary children either. This bounds the representation retained for
current reads; it is not evidence of a production latency improvement.

The
[executor recovery tests](../../libs/pi-runtime/src/durable-executor.test.ts)
exercise 35-turn children ending in valid output or cap exhaustion. They verify
one small, standalone checkpoint commit, reopened values and turn counters, and
recovery of the parent's completed result without another model call. The
representation tests separately check the default 30-turn lifecycle and the
seven-byte difference.

### Remaining attempt decision

Attempt checkpointing remains disabled. Neither completion-only nor a periodic
threshold alone preserves admission of all currently valid commits. Before
adopting a policy, decide how to handle oversized full states and unrelated
writes in the same aggregate commit. A size-aware fallback or an explicit
output/lifecycle bound requires a separate design decision.

This probe introduces no storage protocol, schema, or generic checkpoint
framework. The child threshold does not establish an appropriate threshold for
attempts, and the attempt deferral does not establish a universal revision
bound.
