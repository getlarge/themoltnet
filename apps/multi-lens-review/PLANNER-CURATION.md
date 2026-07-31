# Planner curation

The topic planner is a specialized, bounded-worktree classification workload.
Its runtime profile, context, and tool policy are part of the review design and
must be curated deliberately. It receives one compact manifest artifact,
reads narrowly selected evidence from an exact detached revision, writes one
result file, and uploads that file as a task artifact.

## Workload

The planner must:

- read one bounded, versioned manifest containing complete file accounting and
  exact per-file patch sizes/digests;
- inspect only selected changed files and specific producer relationships in
  the exact-revision worktree;
- semantically identify machine-produced or derived files using content or
  producer/consumer evidence;
- group every remaining file into one bounded primary topic;
- choose only necessary review lanes; and
- write exactly one strict `TopicPlan` JSON result in scratch, upload it with
  `moltnet_upload_task_artifact`, and reference the returned CID in
  `submit_freeform_output.artifacts[]`.

It must not review implementation details, modify the checkout, create commits,
fetch or switch revisions, execute project code, search a diary, or inventory
the repository. The compact manifest is the complete accounting source of
truth. The daemon supplies a detached worktree at the exact head revision plus
a writable scratch area for the result artifact; the task brief also names the
exact comparison base for bounded Git inspection.

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

The planner runtime policy should be evidence-focused:

- allow task facts, read/search access to exact changed files, bounded
  read-only Git inspection, `write` for the single
  `review-topic-plan.v1.json` result, task-artifact upload, and one structured
  output submission;
- if a local calculator or shell is exposed, allow scratch-only coverage
  accounting, budget arithmetic, and JSON validation while keeping artifact
  access on the registered task-artifact tools;
- deny broad checkout inventories, unrelated writes, diary mutations, GitHub
  mutations, subagents, network fetches, and unrelated task/artifact discovery;
- do not invent a static executable list. The runtime capability section and
  effective policy are authoritative; no attached policy means the normal
  allow-all semantics apply.

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
use `moltnet_list_task_artifacts` on the exact producer task, select the unique
versioned artifact by kind and title, and pass its CID to
`moltnet_download_task_artifact`. Reconstructing the accepted attempt through
`moltnet_get_task` plus `moltnet_list_task_attempts` is unnecessary when the
payload was deliberately uploaded to the task-artifact API. These are task
capabilities and belong in the brief and runtime profile; the workflow should
not invent a second persistence or artifact-discovery path.

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

Correlation `58409824-51af-4ae9-bdad-749c0fcd1c2b` then produced the first
accepted full-fixture plan under the corrected contract. Planner task
`34508e9e-9adb-42f2-83d6-49148a7f1c3c` ran the verified
`ollama-cloud/kimi-k2.7-code:cloud` model with no output cap. It consumed
603,011 input and 42,928 output tokens, used the empty scratch workspace plus
local shell for its ledger, and accessed review content only through exact
task-artifact CIDs. It uploaded a discoverable 7,185-byte
`review-topic-plan.v1.json` artifact with CID
`bafkreih7r4r7eftryj7xamwhigfr72xni4ircytrhvc3lgyo2buyxxu75y`;
attempt output metadata separately recorded CID
`bagaaiera4urhbdnc7zgmo2lcf2f5lqmxo7p23hied5kyflabxotfxeosz2fa`.
Trusted validation accepted seven bounded topics, eight evidence-backed
derived-file exclusions, complete primary ownership of the remaining 62 files,
and a normalized specialist cost of exactly 32.

The following design-preflight task
`de172bcf-b059-488c-be17-1636cbe514b9` failed output validation because its
profile lacked the `verification-and-artifacts-v1` context after prompt
ownership moved out of the runtime kernel. The model repeatedly returned the
obsolete `{output: ...}` wrapper. This was a profile-contract failure, not a
planner failure, and the fixed graph correctly released no specialist tasks.

An `absurdctl dump-task` audit clarified the recovery boundary. The workflow
had committed `planner.create` and `preflight.create`; orchestration attempts
two and three replayed those same MoltNet task records and did not rerun the
planner. Absurd already provides the required durable checkpoint semantics.
The defect was that a terminal preflight task remained terminal, so blindly
retrying the parent only observed the same failure. Substantive task outputs
and patches remain in MoltNet artifact storage; Absurd should checkpoint only
small control-plane references. The workflow now stores task IDs rather than
entire returned task records and supports explicit reuse of an accepted planner
task after exact team, diary, task-kind, manifest-reference, accepted-attempt,
and runtime-profile validation. This lets a new durable run replace the failed
preflight without paying for or trusting a second plan.

Failed agent attempts are a separate platform limitation: task workflow state
currently stamps resumable daemon state only on completed attempts, and retry
triage deliberately treats exhausted `output_validation_failed` as
non-retryable. Therefore a failed model session is not generally resumable
today. Durable artifacts, messages, and accepted task attempts remain
available; `continueFrom` can resume a completed freeform attempt. Any future
"recover any failed agent turn" feature must explicitly define safe
checkpointing and continuation semantics for failed attempts rather than
smuggling session bodies into Absurd.

Qualification task `22a6cbab-247b-4603-a43f-3bdf4396dfaa` then ran the
corrected reviewer profile with `verification-and-artifacts-v1` visibly
injected. The Qwen reviewer successfully resolved the accepted planner task and
downloaded its explicit task artifact, proving that the artifact-tool contract
was fixed. It still failed after 294,603 ms, 873,160 cumulative input tokens,
and 19,430 cumulative output tokens because all three submit corrections sent
an invalid `verification` shape.

This exposed a second harness defect. `baseTask` gave every review phase a
`submit-versioned-json-artifact` success gate even though only the planner
uploads such an artifact. Task creation also adds the canonical
`submit-output` gate. The redundant two-gate contract was false for preflight,
lanes, reducers, and synthesis, and it disabled the submit tool's deterministic
single-gate repair path. Only the planner now declares the uploaded-plan gate;
the other phases rely on the server-owned submit-output gate. Model behavior
still matters, but an irrelevant criterion must not prevent safe wire-shape
repair.

The same audit caught a storage-boundary leak in the orchestration return
value. Patch and topic bytes were already remote-only and durable steps had
been reduced to task IDs or CID records, but the final Absurd result still
copied the parsed plan, preflight, topic verdicts, and global verdict. Absurd
persists task results in Postgres, so this was not acceptable. The durable
result is now a compact reference envelope containing task IDs, accepted
attempt numbers, output CIDs, the planner task-artifact CID, and bounded trusted
coverage/cost accounting. The CLI hydrates the presentation verdict from the
referenced MoltNet accepted output after Absurd completes. Tests explicitly
assert that agent-produced bodies are absent from the durable result.

## Topic-review fan-out incident and harness correction

Correlation `4bead2fa-4175-4fbd-bc6f-6924a4bfeaa5` advanced through the
accepted seven-topic planner output and design preflight, then exposed a
review-harness failure. The old graph expanded the seven topics into 32
topic-by-lane tasks and released all of them at once. This number was not a
retry budget: it was the Cartesian sum of the normalized lane sets. Two daemon
workers processed 16 and 17 tasks before the run was stopped.

Those lane tasks ran in empty scratch workspaces. Although each had a bounded
topic artifact, the reviewer also needed surrounding repository context for
call-site checks, established abstractions, and the mandatory repo-wide
DRY/codebase-fit search. One task tried to read a host checkout path that did
not exist in the guest. Another consumed 349,812 cumulative input tokens and
2,675 output tokens in 71,209 ms without completing useful review. This was a
harness mismatch, not evidence that the selected model was incapable: the
artifact-only scratch contract contradicted the actual deep-review contract.

The corrected graph uses the exact reviewed 40-hex commit in a daemon-created
detached worktree for design preflight and topic review. GitHub Actions keeps
trusted runtime code on the base checkout and fetches the untrusted head only
as an inert Git object. The bounded topic artifact remains the authoritative
changed-line scope; the worktree exists only for surrounding code and
repository search. Review tasks may not switch branches, modify files, install
dependencies, or execute project code.

The default fan-out is now one multi-lens reviewer per topic, not one task per
topic-lane pair. Explicit lane profile overrides split a topic only when lanes
resolve to genuinely different runtime profiles. Trusted code validates the
nested lane results, derives each topic verdict deterministically, and stages a
single immutable topic-verdict artifact for global synthesis; the redundant
model reducer layer is gone. The first, highest-value topic is a canary: its
artifact download, exact-revision workspace, output schema, and complete lane
coverage must all pass before any remaining topic review is created. Every
child task has `maxAttempts: 1`; turn and output limits are curated in the
runtime profile rather than multiplied by orchestration retries.

For the accepted seven-topic fixture, the expected default review fan-out is
seven topic tasks instead of 32 lane tasks. This is a design expectation, not
an acceptance result. Do not launch the full fixture again until focused
typecheck, unit tests, lint, and build pass, then qualify the runtime with the
single canary before allowing the remaining six topics.

## Exact-revision preflight canary

Correlation `a9a5b5f3-de1f-4969-a945-f1f61099ee01` qualified the revised
workspace and artifact harness against a two-line file from PR #1730 before any
full-fixture rerun. Preflight task
`695f1fdc-a6ee-46dc-a967-b568aee8ca17` was claimed exactly once with
`workspaceMode: dedicated_worktree`, `workspaceBranch: null`, and exact
`workspaceRevision: 9a25d041e153e4ef549005cb5c35714f88e0e530`. The prompt
injected only `verification-and-artifacts-v1`; proactive memory was absent.
The model correctly used `moltnet_list_task_artifacts`, downloaded both bound
artifacts in parallel, and read them successfully.

The task still failed after 94,597 ms because the preflight contract invited
open-ended repository exploration. Kimi used all ten allowed tool turns and
the runtime stopped it with `max_turns_exceeded` before submission. Even for
this two-line input, cumulative usage reached 257,367 input tokens and 3,084
output tokens. Raising task attempts would repeat the same deterministic
harness failure; the task correctly had `maxAttempts: 1`.

The correction is phase-specific rather than a larger retry or response
budget. Planned preflight now binds only the immutable manifest and discovers
the accepted planner's explicit uploaded plan through
`moltnet_list_task_artifacts`; it does not bind every per-file patch or repeat
the planner's generated-file classification. Deterministic small-change
preflight still binds its bounded patches, but follows a five-turn protocol:
inventory, parallel download, parallel read, at most one named-symbol
repository query, then submit. The prompt explicitly forbids package
inventory, broad generated-file searches, dependency installation, project
execution, and exploratory documentation reads. This retains the
exact-revision worktree for design evidence without treating it as an
unbounded research assignment.

Correlation `8d22ca7c-15af-45b6-be60-7e8ecf243428` confirmed that correction.
The revised preflight completed on its only attempt in 47,869 ms with 143,986
input tokens and 2,159 output tokens. It followed the intended sequence:
task-artifact inventory, parallel downloads, parallel artifact and changed-file
reads, one targeted search batch, then `submit_freeform_output`. Its accepted
output CID was
`bagaaierawb5yifxnnjtakqywtzpbvbgltgff4y6wajt23zp5u5pjpkmwqhdq`.

The same correlation then qualified the grouped topic-review canary and found
one remaining phase-specific harness problem. Task
`dcaa2506-d35c-4f38-8772-9f783b61375e` correctly used the sole topic artifact
and exact detached review revision, but its prompt still requested a
"repository-wide" DRY search without bounding the search protocol. It used all
ten turns on repeated reads, shell commands, and searches, then failed before
submission with 261,471 input tokens and 1,514 output tokens in 54,131 ms.
Again, there was one task attempt rather than a retry storm.

Topic review now has the same explicit harness discipline as preflight:
inventory, download, patch read, parallel reads of declared topic files, at
most one parallel batch of exact changed-symbol or signature searches,
optionally at most two directly matching files, then submit within seven
tool-use turns. Shell, directory/package/doc inventories, generic searches,
and iterative exploration are out of contract. The mandatory
`dry-codebase-fit` lane still receives repository evidence, but a bounded
symbol/signature search is sufficient; "repository-wide" no longer means an
open-ended research assignment.

Correlation `2aaaec20-6945-4621-9030-1003f82c3be9` showed that the bounded
topic protocol is viable but also exposed a schema-language ambiguity. The
preflight completed on its only attempt in 43,576 ms with 169,907 input tokens
and 1,262 output tokens. Topic task
`042b04ac-6b7f-4af3-a4e3-0ee16e19c746` remained artifact-scoped, ran at the
exact detached revision, did not use shell, and submitted on its only attempt
after eight turns. Its usage was 199,396 input tokens and 6,137 output tokens
in 128,348 ms; most latency came from the bounded exact-symbol search batch.

Trusted reduction rejected that otherwise valid task result because the
`dry-codebase-fit` lane listed an evidence-only repository match,
`libs/tasks/src/wire.ts`, in `reviewedFiles`. That field is the primary-change
coverage claim, not an inventory of every context file consulted. The
rejection was correct: silently accepting extra paths would blur topic
ownership and could corrupt the coverage ledger. The prompt and success gate
now say that each lane's `reviewedFiles` must equal exactly the topic's
`primaryFiles`. Declared context and repository-search matches may inform
findings but never appear in the ownership claim.

Correlation `357fe12f-d7e4-4461-93d3-b3a9253535bf` completed the one-file
exact-revision acceptance canary end to end after that clarification. All
three model tasks completed and were accepted on their first and only attempt:

- design preflight `42149ab9-09e1-4e98-9f0f-bc3ec495013d`;
- grouped topic review `4edb44f2-8a61-4646-82b8-51686026cef5`; and
- global synthesis `2d37bda9-e979-46ea-9be9-d804bc44e4b5`.

Trusted accounting reported one primary owner for
`libs/models/src/hash.ts`, complete correctness, dry-codebase-fit, and
design/API/backcompat lane coverage, no excluded files, and an approval
verdict. The durable result contained only task/output references, the
topic-verdict artifact reference, and bounded diagnostics; the CLI hydrated
the preflight and verdict bodies from the accepted output CIDs. Total cost was
3 tasks, 4 artifacts, 350,485 input tokens, 10,417 output tokens, and 1,783
artifact bytes. The topic review submitted in seven turns without shell use,
and synthesis used only task-artifact inventory, download, read, and submit.

This qualifies the task/workspace/artifact harness on a small exact-revision
fixture. It does not replace the required full PR #1730 acceptance, which must
still demonstrate semantic exclusions, multiple bounded topics, complete
primary coverage, two-worker fan-out, and terminal synthesis at fixture scale.

## Full-fixture staging correction

Correlation `e5bbb3a2-2eaf-450c-a8c3-1b948b7f2606` began the first current
PR #1730 full-fixture run (389,258 raw diff bytes, 70 files, 9,755 changed
LOC). Before the planner was useful, ingestion remotely staged 70 complete
per-file patch sections plus the manifest. This included a roughly 203 KiB
derived snapshot that semantic classification was expected to exclude. The
planner downloaded only selected artifacts, so the model context remained
selective, but the storage and staging fan-out had already happened. Staging
took roughly two minutes and created 71 input artifacts.

The run was stopped and the ingestion boundary changed. A review manifest now
commits to every exact per-file patch with its byte count and SHA-256 but
contains no patch payload or per-file artifact CID. Only that compact manifest
is uploaded before planning. The planner runs in the exact detached review
worktree and receives the exact comparison-base revision for bounded Git
inspection. After trusted validation removes derived output and fixes topic
ownership, orchestration reads patch bytes from its replayable trusted input
source, verifies every byte count and digest, and uploads one complete artifact
per accepted topic. Absurd still stores only bounded manifest/task/artifact
references; neither the whole diff nor patch bodies enter workflow state.

This preserves immutable accounting and crash replay while eliminating
preemptive payload fan-out. A rerun must verify the expected artifact shape:
one input manifest, one planner output, one artifact per accepted topic, one
topic-verdict bundle, and no complete artifact for a model-excluded file.

## Full PR #1730 acceptance and recovery experiment

The accepted planner task
`61aa5f40-d1e8-477c-9237-c93d08fca42d` produced its plan as the required
`review-topic-plan.v1.json` task artifact. Its compact manifest was 36,943
bytes and its plan artifact was 7,507 bytes. The plan classified eight
machine-produced or dependency-resolution files as exclusions using content
evidence rather than repository-specific path rules, then assigned all 62
remaining reviewable files to exactly one of nine topics.

The first full review run used an eight-turn runtime limit. Preflight and four
topic reviews completed, while the other topic tasks reached the cap or were
cancelled during cleanup. A recovery run raised the cap to 16 and reused every
accepted output. It created only the five missing topic tasks; it did not
repeat planning, preflight, or accepted reviews. This also exposed two output
quality failures: one result contained invalid JSON escaping and another
appended prose after otherwise valid JSON. Trusted parsing rejected both.
A further correction was rejected because it claimed findings in a file
owned by another topic. The final accepted correction kept findings and
`reviewedFiles` within the topic's primary ownership.

Warm continuation initially failed before model execution because the source
resolver remembered only a branch name. Exact review tasks are deliberately
detached, so the continuation degraded to a shared workspace and violated its
runtime policy. Continuation resolution now inherits the accepted parent
attempt's exact `input.execution.revision`, recreates a dedicated detached
worktree, and preserves the accepted task's team, diary, artifact, topic,
lanes, and profile contracts. Continuations are extend-only, claim-gated, and
non-recursive. Cleanup now cancels only waiting or queued work; it does not
discard running or dispatched attempts that may still produce reusable
accepted output.

The first global synthesis task revealed a separate harness problem. Although
its only input was the topic-verdict artifact, the prompt did not bound the
tool protocol, so the model spent 16 turns using shell and workspace tools and
never submitted. Synthesis now explicitly permits only artifact inventory,
download, one read, and terminal submission. It forbids repository, memory,
shell, write, and task-list exploration, preserves the highest-impact
findings, and caps the combined verdict at 20 findings.

Correlation `e039be29-752e-4d5d-8ddf-3f419fde344c` completed the full
acceptance graph. Global synthesis task
`ce452601-b030-4218-8bb5-1eef97d30977` accepted output
`bagaaiera2afg2c6ghk2xg5xoz2uzbh2ljy3ej5kdt6ldqc7g4t6wphjpwt3q` from topic
verdict artifact
`bafkreiaewon2k23vc6xlh4sydx23pi6rsqcj6a7gkiydrsjcisloipsxpi`.
Trusted accounting reported complete primary-file and mandatory-lane coverage
and a request-changes verdict with 20 findings. Synthesis reached the model's
output boundary once, then used the same warm session to submit on the next
turn; the accepted attempt used 95,135 input and 18,182 output tokens over
145,641 ms.

The logical accepted graph comprised 12 tasks: planner, design preflight, nine
topic reviews, and global synthesis. Across those selected accepted attempts
it used 2,382,196 input tokens, 101,629 output tokens, and 1,638,788 ms of
aggregate model runtime. The immutable remote inputs and outputs comprised 12
unique artifacts totaling 248,348 bytes:

- one 36,943-byte compact manifest;
- one 7,507-byte planner artifact;
- nine topic patch artifacts totaling 158,185 bytes; and
- one 45,713-byte topic-verdict artifact.

The original diff was 389,258 bytes. No whole-diff artifact and no patch
artifact for any excluded generated file was uploaded. The nine topic patch
artifacts ranged from 2,464 to 53,694 bytes, remaining within the configured
topic bounds.

Two released-CLI compatibility findings should be handled separately:
`moltnet task continue --title` currently puts `title` inside the freeform
input and fails schema validation, while `moltnet task attempts` against the
newer local API rejects the additive `leaseId` response field. Neither was
worked around in workflow contracts.

The experiment supports a few model-curation conclusions. Fast planning is
viable when the model receives a compact ownership manifest plus an exact
worktree, not pre-uploaded file bodies or unrelated diary context. Per-phase
runtime profiles need realistic turn and output limits, but retries should
remain exceptional: accepted phase outputs are durable and recovery should
create only missing or explicitly corrected work. The output cap remains a
meaningful synthesis constraint; a higher-output synthesis profile or a
smaller finding cap can reduce the need for a warm terminal-submit turn.
