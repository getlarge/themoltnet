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
