# Planner curation

The topic planner is a specialized, artifact-only classification workload. Its
runtime profile, context, and tool policy are part of the review design and
must be curated deliberately. Artifact-only does not mean that every operation
is read-only: the planner writes one result file in scratch and uploads it as a
task artifact.

## Workload

The planner must:

- read one bounded, versioned manifest and selected immutable per-file
  artifacts;
- semantically identify machine-produced or derived files using content or
  producer/consumer evidence;
- group every remaining file into one bounded primary topic;
- choose only necessary review lanes; and
- write exactly one strict `TopicPlan` JSON result in scratch, upload it with
  `moltnet_upload_task_artifact`, and reference the returned CID in
  `submit_freeform_output.artifacts[]`.

It must not review implementation details, modify a checkout, create commits,
search a diary, or inspect files from the daemon's mounted repository. The
staged artifacts are the complete and immutable source of truth. Every review
task explicitly requests `execution.workspace: none`: the daemon supplies a
writable scratch workspace for artifact download and result creation, without
mounting or checking out the repository.

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

The planner runtime policy should be artifact-focused:

- allow task facts, exact referenced-artifact download, read/search access to
  the downloaded files inside the scratch workspace, `write` for the single
  `review-topic-plan.v1.json` result, task-artifact upload, and one structured
  output submission;
- deny shell, checkout reads, other writes, diary mutations, GitHub mutations,
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

The next independent qualification requested `kimi-k2.7-code:cloud` with low
thinking, a 12,000-token output cap, the same minimal context and enforced
download/read/grep policy. A later durable-session audit proved that the
executor silently fell back to `gemma4:31b-cloud`; none of the runs in this
section qualify Kimi itself. The user-approved representative input was 26
files, 122,447 reviewable bytes and 2,575 changed LOC. Correlation
`9ee836eb-a26a-4c02-87f9-5d11255906c2` produced planner task
`d85d6f8f-a911-4b23-b4df-240d073e92ff` and durable output CID
`bagaaierajcnotpmcqr5winmgb5fszv6lp5flbv3unsvmziy2mgticryb6fua`.

This run materially improved isolation and responsiveness:

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

The same Kimi-labelled qualification was repeated after those corrections and
after rebasing onto `origin/main`. The first attempt reached the local API before
it could spend model tokens, then failed closed because the source expected the
new `runtimeKind` authority contract while the isolated e2e API image and
database schema were still from the older main revision. Rebuilding the database
and REST API images, applying migrations, and recreating only those services
fixed the environment. This is an acceptance-harness lesson: after a
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

The first full merged-PR #1730 Kimi-labelled run used correlation
`e21d96f9-9572-4c79-8274-6976f420b01b`, planner task
`d4fd5464-f9e3-454e-8010-d3a3a8e6b601`, and attempt output CID
`bagaaieratimgavxkbfwvbtwffmhtaniyjnyyj4ylgb5s5admhzwlg7wfetnq`. The
planner took 218,893 ms and consumed 79,052 input plus 15,552 output tokens.
Trusted validation correctly rejected it before specialist release because one
of 66 reviewable files had no primary owner and the normalized plan required
46 specialist tasks, above the maximum of 32. Several of its nine exclusions
also cited only naming conventions rather than observed semantic evidence.

This run exposed an important distinction in the task API: an accepted
attempt's `outputCid` is durable attempt metadata, but it is not a
discoverable/downloadable task artifact. The planner must use the Pi tools
explicitly:

1. write the exact JSON to `review-topic-plan.v1.json`;
2. call `moltnet_upload_task_artifact` with the versioned kind and content
   type; and
3. put the returned CID, content type, and size in
   `submit_freeform_output.artifacts[]`, with only a short confirmation in
   `summary`.

Trusted orchestration downloads that explicit CID through the task-artifact API
and rejects missing, duplicate, incorrectly typed, size-mismatched, or
oversized artifacts before parsing and validating the artifact as the sole
`TopicPlan` payload. Repeating the full plan in `summary` doubled the
model-visible serialization work and made response truncation more likely
without adding durability. Downstream prompts must likewise use the explicit
artifact CID rather than the attempt `outputCid`. A downstream Pi task should
use `moltnet_get_task` to resolve the producer's `acceptedAttemptN`,
`moltnet_list_task_attempts` to read only that accepted structured output, and
`moltnet_download_task_artifact` with the explicit `artifacts[]` CID and
accepted attempt number. These are task capabilities and belong in the brief
and runtime profile; the workflow should not invent a second persistence or
artifact-discovery path.

One more runtime fact emerged. Gemma first ended in prose, recovered after one
missing-submit prompt, then attempted the submit tool twice. The first-valid
payload was preserved and the duplicate ignored, but an experimental
`terminate` field on the tool result did not stop Pi because tool-result
metadata is not session control flow. The submit tool now invokes an
executor-owned completion callback after the first valid capture; the executor
aborts the live Pi session while normal captured-output finalization continues.
Invalid submissions remain recoverable and never trigger that completion
boundary.

A durable-session audit after the later write failure found the actual harness
defect. Every Kimi-labelled session above records
`ollama-cloud/gemma4:31b-cloud` in its `model_change` entry. `executePiTask`
used pi-ai's built-in-only `getModel()` against the custom `ollama-cloud`
provider; the lookup returned `undefined`, and pi-coding-agent silently selected
the default from `.pi/settings.json`. The workspace also mixed pi-ai 0.74.0
with pi-coding-agent/pi-ai 0.79.4. Task
`1980c484-d44a-455f-80c8-be2e42b3f8c5` did run in the intended writable
scratch task workspace, but its Gemma response consumed exactly the
20,000-token output cap and persisted a `write` call whose `content` ended
mid-JSON before a `path` argument arrived.

Do not compensate for that failure with more prompt call-shape prose. Resolve
the exact profile model through Pi's custom `ModelRegistry`, pass the same
registry into the session, align the Pi package versions, and fail session setup
when the requested model is missing. Model qualification telemetry must record
and compare the runtime-profile selection with the durable Pi session model.
Only a fresh run after that invariant passes can qualify Kimi. Incident:
`41e5f237-f25a-46d9-9d28-2b97ca3f00fb`.

The first fallback-free Kimi run against the full merged PR #1730 fixture used
correlation `93391e3b-c185-4eb9-a968-c022531d8793`. The runtime profile and
durable session both selected `ollama-cloud/kimi-k2.7-code:cloud`, the workspace
was an empty scratch mount, and only the enforced artifact-planner tools were
visible. The attempt nevertheless hit the profile's artificial 16,000-token
per-response cap twice before submission. It was cancelled after 480,069 ms,
351,100 input tokens, and 37,353 output tokens.

That experiment shows that `maxOutputTokens` is an operator/model response
guard, not a topic-plan budget. The trusted parser and plan validator already
enforce the durable output's schema, bytes, files, topics, overlap, lanes, and
task count. For this planner, leave `maxOutputTokens` unset unless a model has
been qualified with a lower cap; do not treat truncation as plan validation.
The immutable task artifact is now the sole plan payload, and the structured
submission carries only its returned metadata plus a short summary.

A clean uncapped retry used correlation
`6349abb2-26fc-4bc1-8414-e831f4bbcf4f`. It confirmed
`maxOutputTokens: null` at execution, but did not qualify planner output: Kimi
attempted to stage files under `tmp/` in the empty scratch mount before that
directory existed, and the local Docker control plane then became unreachable.
Reporter flushes, artifact downloads, lease heartbeats, CLI reads, and Docker
inspection all failed. These are harness/infrastructure failures, not evidence
about Kimi's plan quality. A future acceptance run must start from a healthy
control plane with a fresh correlation.

A later run showed that pre-provisioning one conventional directory was the
wrong abstraction. Kimi selected `scratch/` instead, while the host-side
`moltnet_download_task_artifact` tool required the output parent to exist. The
tool now creates arbitrary nested parents only after resolving the nearest
existing ancestor inside the host task workspace, then re-resolves the created
parent to reject symlink escapes. No directory-name allowlist or pre-created
path is needed.

Correlation `fed5da66-24d9-4bf5-bcbc-e8c09ffcff55` verified that separation:
eight nested host artifact downloads succeeded, and VM `read` and `write`
succeeded against the mounted files. Two VM `grep` calls alone returned
`exec failed`. Durable-session inspection showed that the tool invoked the
hard-coded `/bin/rg`, despite the sandbox installing ripgrep through its package
manager and exposing executables through `PATH`; the VM tool now invokes `rg`
without inventing a static absolute path.

The same session also explained one misleading manifest download. The generic
task-contract prompt exposed the immutable task-input provenance CID as merely
“Task input CID”. Kimi mistook it for the attached task-artifact CID and tried
to download it. All task types now label that value as a verification
provenance identifier that is not a task artifact and cannot be downloaded.
The bounded manifest remains embedded in the planner brief and independently
bound as an immutable task reference.

Correlation `8c2704dd-915c-4e3c-99bb-e12712c06afe` then completed the first
fallback-free, uncapped artifact submission. Planner task
`f4dca06a-bcb7-4b65-8b51-d6ba5a5ba9c3` wrote and uploaded a 5,825-byte
`review-topic-plan.v1.json` artifact with CID
`bafkreiep3fr2tqzgay622iox3ygylysmewimqwomehhk7z6oqqz6yzbr74`, then submitted
only its short confirmation and artifact metadata. There was no length stop.
The final submission turn used 111,456 input tokens and 440 output tokens; the
complete planner task took 594,571 ms, 492,211 cumulative input tokens, and
72,859 cumulative output tokens.

Trusted validation correctly rejected that plan before specialist fan-out
because its normalized topic lane unions required 43 specialist tasks. The
preflight task was cancelled and the run could not approve. Replaying the
accepted plan against the then-current trusted classifications showed that this
was not just missed arithmetic: after the seven model exclusions, an exhaustive
enumeration of every six-topic lane-mask combination under the 32-task cap found
no feasible assignment for the remaining 63 files, even before topic byte or
semantic-cohesion constraints. The planner had been asked to solve an
internally infeasible packing problem.

The trusted classifier was over-applying specialist lanes: every code file
received tests and readability, generic words such as `update` triggered
performance, and test fixtures inherited production security/design lanes from
the feature vocabulary they asserted. Classification is now selective and
repository-agnostic: test/spec/e2e evidence selects tests; production security,
performance, public-contract, and operability lanes require specific path or
content signals; large production patches select tests and readability.
Correctness and DRY/codebase-fit remain mandatory everywhere. The planner guide
also reports the minimum topic count implied by the file cap and the resulting
maximum average topic cost. Against the same frozen fixture and the same seven
semantic exclusions, a byte-constrained six-topic packing now exists at 27
specialist tasks. Do not launch another model acceptance until the revised
classifier, preflight budget output, and focused Nx validation pass.

The planner prompt now also makes the host/guest artifact boundary explicit:
references do not materialize guest files, selected CIDs must be downloaded
before VM reads, and independent downloads should be batched. Planning is not
line-level review. The bounded manifest is sufficient for most grouping; the
model must inspect every proposed exclusion and its producer evidence, but may
download at most eight additional representative authored patches. This keeps
semantic discovery with the model while preventing exploratory reads from
turning every planner turn into a replay of a growing review transcript.

Correlation `9db47417-137e-480d-a4e8-53d1b3445c6f` was the first run after
that curation and the selective-lane change. Planner task
`b8f34478-4d5e-4012-9d8f-7a6029a1d15a` ran the exact requested
`ollama-cloud/kimi-k2.7-code:cloud` model with `maxOutputTokens: null` in the
empty scratch workspace. It completed in 297,389 ms with 366,610 cumulative
input and 40,337 cumulative output tokens. The model uploaded a discoverable
6,866-byte `review-topic-plan.v1.json` task artifact with CID
`bafkreigpjr4ypg56gsjr2kdtuo7274tzsglanfvzteau7awxheytfovom4`; the accepted
attempt metadata separately recorded output CID
`bagaaierahojjhvoip7a62sh57krlf7qx2guqibpi3ypwmv3cdov2yxhajk3a`.

The plan showed that semantic generated-file discovery now works without a
repository or ecosystem allowlist. It excluded ten derived artifacts with
content or producer evidence: the OpenAPI document, the TypeScript and Go
clients derived from it, two Drizzle metadata outputs, the pnpm lockfile, and
the release-please version manifest. It retained the authored migration SQL,
release configuration, and generator script. Every one of the remaining 60
files had exactly one primary owner across seven bounded topics.

Trusted validation still rejected the plan before specialist release because
the normalized topic lane unions cost 35 tasks, three above the hard maximum.
The individual topic costs were 6, 6, 6, 6, 5, 3, and 3. The model left every
optional `lanes` array empty, so the overage came entirely from the trusted
per-file lane unions and topic grouping. The preflight task was cancelled and
no lane, reducer, or synthesis task was released.

This is not a response-cap failure. The uncapped response completed and the
small authoritative artifact was uploaded successfully. It is also not a
missing-context failure: the prompt included every required lane and explicitly
required a <=32 cost audit. The remaining harness defect was a contradictory
execution contract: it asked the planner to write a scratch cost ledger while
also forbidding shell commands and allowing `write` only for the final plan.
The planner contract now names the immutable manifest CID explicitly and lets
the model use whatever local calculator or shell the effective runtime actually
exposes for scratch-only coverage, arithmetic, and JSON validation. MoltNet
artifact access remains restricted to the host-provided task-artifact tools;
the planner must not invoke CLI wrappers or inspect the daemon checkout.

The next qualification run should use a planner profile whose policy and
sandbox expose a local calculator, and the runtime capability prompt should
confirm that availability. If no policy is attached, the normal allow-all
semantics apply; the recipe must not reintroduce a contradictory static tool
ban. Do not retry the model merely by raising an output cap: validate that it
actually computed the topic ledger, and keep trusted rejection as the terminal
behavior for any submitted over-budget plan.
