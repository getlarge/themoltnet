# Planner curation

The topic planner is a specialized, read-only classification workload. Its
runtime profile, context, and tool policy are part of the review design and
must be curated deliberately.

## Workload

The planner must:

- read one bounded, versioned manifest and selected immutable per-file
  artifacts;
- semantically identify machine-produced or derived files using content or
  producer/consumer evidence;
- group every remaining file into one bounded primary topic;
- choose only necessary review lanes; and
- submit exactly one strict `TopicPlan` JSON task artifact.

It must not review implementation details, modify a checkout, create commits,
search a diary, or inspect files from the daemon's mounted repository. The
staged artifacts are the complete and immutable source of truth.

## Profile selection

Do not assume that the default specialist model is a good planner. Evaluate a
planner profile against representative large manifests for:

- reliable strict JSON and submit-tool use;
- enough context for the bounded manifest and selectively downloaded files;
- accurate semantic generated-file classification;
- instruction following around topic, byte, file, and task-count budgets;
- latency, input tokens, and output tokens; and
- recovery behavior after an unavailable artifact or tool error.

A fast structured-output model is preferred when it satisfies those gates.
Keep specialists and synthesis independently routable to deeper models.

## Context and policy

Use a planner-specific minimal context. Generic engineering, diary, commit,
branch, and pull-request instructions add irrelevant tokens and encourage
out-of-scope behavior.

Apply the versioned `artifact-planner@v1` runtime-profile context recipe. It is
ordinary, editable profile context rather than a hidden preset. The runtime
kernel separately reports the effective tool and shell-command policy, so the
planner sees both its behavioral contract and its actual capabilities.

The planner runtime policy should be read-only and artifact-focused:

- allow task facts, exact referenced-artifact download, read/search access to
  the downloaded files inside the scratch workspace, and one structured output
  submission;
- deny shell, checkout reads, writes, diary mutations, GitHub mutations,
  subagents, and unrelated task/artifact discovery;
- avoid paginating task artifacts: the manifest and task references contain
  the exact CIDs; and
- make network and executable requirements empty unless the chosen runtime
  itself requires them.

## Acceptance learnings

PR #1730 is the large acceptance fixture, not a source of repository-specific
classification rules.

The first acceptance planner used `glm-5.2:cloud`, took roughly 12.5 minutes,
consumed 664,419 input tokens and 32,134 output tokens, then produced a durable
artifact that trusted validation correctly rejected. It exceeded the
32-specialist-task budget and included excluded or primary files as context.
Some exclusion evidence only repeated path conventions.

A subsequent fast-model trial exposed two context/policy problems before its
result was known:

- task-artifact pagination returned `Invalid task artifact cursor`; and
- the model inspected the mounted base checkout for a PR-only file instead of
  using its pinned artifact CID.

These are curation failures, not reasons to add filename heuristics. Before
another acceptance attempt, verify the selected model, minimal injected
context, artifact-only runtime policy, output limit, prompt, and task-artifact
submission contract together.

The first post-refactor qualification used `deepseek-v4-flash:cloud` with low
thinking, a 16,384-token output cap, the sole `artifact-planner@v1` context
entry, and enforced artifact-only policy against the then-current PR #1730
fixture (389,258 raw diff bytes, 70 files, 10,332 changed LOC). Immutable
per-file staging completed successfully but took roughly 72 seconds because
uploads were sequential. The planner then:

- took about 424 seconds to emit its first token;
- emitted fenced JSON prose instead of calling the submit tool initially;
- justified exclusions with filename and directory conventions despite the
  explicit semantic-evidence rule;
- exhausted the 16,384-token response limit; and
- called `submit_freeform_output` only after the runtime's missing-submit
  recovery prompt.

That final call revealed a separate runtime-policy defect:
`submit_freeform_output` was not in the enforced allowlist, so policy rejected
the mandatory output tool. The qualification was cancelled and must not be
treated as a valid planner result. The runtime now always permits its reserved
task-specific `submit_*` protocol tools because they only validate and capture
the active task output; they grant no external capability and cannot be
registered by runtime extensions.

The cancelled attempt ran for 660,129 ms and consumed 81,109 input tokens plus
28,070 output tokens without producing an accepted artifact. Those counts
include the length-stopped first response and missing-submit recovery turns.

Artifact-only also does not mean download-only:
`moltnet_download_task_artifact` materializes a file in the scratch workspace,
so the planner needs bounded `read`/`grep` access to inspect it. The qualified
operator policy is therefore exact artifact download plus scratch-file
read/search, with no shell and no discovery tools; the runtime-owned submit tool
is added separately. Verify the model-visible session tools include that submit
tool before spending model tokens.

The next independent qualification used `kimi-k2.7-code:cloud` with low
thinking, a 12,000-token output cap, the same minimal context and enforced
download/read/grep policy. The user-approved representative input was 26 files,
122,447 reviewable bytes and 2,575 changed LOC. Correlation
`9ee836eb-a26a-4c02-87f9-5d11255906c2` produced planner task
`d85d6f8f-a911-4b23-b4df-240d073e92ff` and durable output CID
`bagaaierajcnotpmcqr5winmgb5fszv6lp5flbv3unsvmziy2mgticryb6fua`.

This profile materially improved isolation and responsiveness:

- the first actionable tool turn arrived in roughly 40 seconds;
- the model downloaded exactly four bound artifacts, read only those files,
  and did not use shell, task discovery, diary memory or the daemon checkout;
- it semantically excluded four derived OpenAPI/client outputs while retaining
  authored files; and
- it covered every remaining file with one primary owner.

It still failed qualification. The task ran 234,644 ms and consumed 164,694
input plus 10,886 output tokens. The model called
`submit_freeform_output` three times because a valid capture did not terminate
the Pi loop, and the last eight-topic plan normalized to 55 specialist tasks,
above the trusted maximum of 32. Trusted validation rejected the plan and no
specialist task ran.

Two reusable corrections follow from this failure:

- structured submission is a completion boundary: the first valid payload is
  immutable and terminates execution, while invalid calls remain recoverable;
- a planner needs manifest-derived budget pressure, not only constants and a
  formula. The prompt now groups trusted required-lane signatures, identifies
  the peak per-topic cost and its affordable topic count, and requires a
  scratch cost ledger before submission. Planner `lanes` are explicitly only
  optional additions; trusted required lanes are added automatically.

This guidance is computed solely from the versioned manifest. It contains no
repository paths, framework names or generated-file conventions. Requalify the
same payload and profile after focused non-model validation; a model or payload
change is a new experiment requiring its own authorization and measurements.

The exact Kimi qualification was repeated after those corrections and after
rebasing onto `origin/main`. The first attempt reached the local API before it
could spend model tokens, then failed closed because the source expected the
new `runtimeKind` authority contract while the isolated e2e API image and
database schema were still from the older main revision. Rebuilding the
database and REST API images, applying migrations, and recreating only those
services fixed the environment. This is an acceptance-harness lesson: after a
runtime-contract rebase, refresh the matching local API and schema before
qualifying a profile.

The successful fresh run used correlation
`2b94092e-2c82-493e-b06f-cd0b37209457`, planner task
`161478fd-b0ef-40dd-bb38-e9c0bdadc1fb`, and durable output CID
`bagaaieravftd2k7idk3ftne62gvdpehxo2oyzxagcobl7ncbkebogjlgftzq`.
It completed in 167,055 ms with 119,196 input and 10,950 output tokens. The
model again downloaded exactly four bound artifacts and used scratch reads
only. It produced four topics whose normalized lane costs were 8 + 8 + 8 + 7
= 31 specialist tasks, excluded four semantically identified derived
OpenAPI/client outputs, retained authored migration/configuration sources, and
gave every remaining file exactly one primary owner. Every topic stayed below
the byte and file limits. Trusted validation accepted the artifact and only
then released the server-gated design-preflight task; that task was cancelled
without model execution because this run qualified only the planner stage.

One more runtime fact emerged. Kimi first ended in prose, recovered after one
missing-submit prompt, then attempted the submit tool twice. The first-valid
payload was preserved and the duplicate ignored, but an experimental
`terminate` field on the tool result did not stop Pi because tool-result
metadata is not session control flow. The submit tool now invokes an
executor-owned completion callback after the first valid capture; the executor
aborts the live Pi session while normal captured-output finalization continues.
Invalid submissions remain recoverable and never trigger that completion
boundary.
