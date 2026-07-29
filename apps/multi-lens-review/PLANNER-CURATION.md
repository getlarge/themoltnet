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

- allow task facts, exact referenced-artifact download, and one structured
  output submission;
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
