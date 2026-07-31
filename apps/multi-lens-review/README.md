# @themoltnet/multi-lens-review

Create a bounded, topic-planned deep review from an untrusted pull-request
diff. The app freezes per-file patch identity, uses an LLM to propose semantic
topics only for large changes, validates that plan in trusted code, then stages
only the accepted bounded topic patches consumed by reviewers.

## Trusted ingestion

Before connecting to MoltNet or staging an artifact, the CLI:

- rejects raw diffs larger than 2 MiB or changes larger than 200 files;
- parses status, additions, deletions, changed LOC, bytes, language, renames,
  binaries, generated headers, and malformed/truncated hunks;
- excludes intrinsically unreadable binaries and files marked
  `linguist-generated` by `.gitattributes` at the trusted base revision;
- never lets PR-head attributes, generated headers, or model prose authorize
  an exclusion;
- uses the LLM to nominate repository-agnostic generated candidates, while
  keeping every candidate primary-owned and reviewable; and
- chooses an LLM planner only above 25 reviewable files, 1,500 changed LOC, or
  64 KiB of reviewable bytes.

Use the side-effect-free classifier locally:

```bash
moltnet-multi-lens-review \
  --preflight \
  --diff-file /tmp/change.diff \
  --files-metadata /tmp/pull-request-files.json \
  --review-base-revision <full-40-hex-comparison-base-sha>
```

It prints intrinsic and trusted-base classification, signals, budgets, and
`requiresPlanning`. Without `--review-base-revision`, it safely performs no
`.gitattributes` exclusions. It does not invoke the LLM, connect, stage
artifacts, or create tasks.

## Artifact and task graph

The raw whole diff and full Git working-tree files are never uploaded as
workflow inputs, artifacts, or specialist references. Before planning, remote
storage receives only one compact versioned
manifest containing complete file accounting plus the byte count and SHA-256
of every exact per-file patch. Trusted-base `.gitattributes` classification is
already frozen into that manifest. The LLM planner uses the manifest and an
exact-revision read-only worktree for bounded semantic grouping and may flag
generated candidates as review hints. Only after trusted plan validation does
orchestration read patch bytes from the trusted replayable input source, verify
every byte count and digest, and stage one immutable artifact per accepted
topic. Base-declared generated files remain in the coverage ledger without
uploading their complete patch payload; model candidates remain in topic
artifacts and mandatory coverage.

```text
trusted ingest + compact manifest
            │
 LLM topic planner + generated hints (large changes)
            │ server gate
        global design preflight
            │ PROCEED only
 verified bounded topic staging
            │
 one canary multi-lens topic review
            │ trusted validation
 remaining multi-lens topic reviews
            │ trusted reduction
  one topic-verdict artifact
            │ server gate
       one global synthesis
```

`PIVOT` and `ASK` stop before line-level tasks. GitHub Actions is unattended,
so `ASK` returns its questions rather than pausing. Invalid plans, failed
required lanes, or incomplete primary-file coverage cannot produce an approval.
The canary must return valid, complete lane coverage before any remaining topic
review is created, so a bad workspace, artifact, profile, or output contract
fails after one review attempt rather than after full fan-out.

The planner's TopicPlan is an explicit task artifact. Preflight, topic-review,
and synthesis bodies are content-addressed accepted task outputs. Trusted code
derives topic verdicts from validated lane results and stages one immutable
topic-verdict artifact for synthesis. All contain strict versioned JSON, and
trusted validation enforces:

- generated candidates referencing exact reviewable manifest paths while
  remaining primary-owned;
- unique topic ids and exactly one primary owner per reviewable file;
- only known files and the eight deep-review lanes;
- correctness and DRY/codebase-fit on every topic;
- bounded context overlap;
- at most 12 topics, 12 primary files per planned topic, 64 KiB per topic
  (128 KiB for a singleton), and normally one topic-review task per topic; and
- no recursive replanning.

Security, performance, design/API/backcompat, tests, operability, and
readability lanes are added through trusted path/content classification. The
planner may add lanes but cannot remove trusted requirements.

Repository-aware phases run in daemon-created detached worktrees at the exact
40-hex review revision. The bounded topic artifact remains authoritative for
changed lines; the worktree supplies the surrounding repository context and
repo-wide search required by deep review. GitHub Actions executes trusted
runtime code from the base checkout, fetches the head object only as inert Git
data, and never runs code from the reviewed revision.
The runtime verifies both `HEAD` and a clean working-tree status before an
exact-revision task starts.

## Run

```bash
MULTI_LENS_REVIEW_DATABASE_URL=<absurd-postgres-url> \
  moltnet-multi-lens-review \
    --team <team-uuid> \
    --diary <diary-uuid> \
    --target "owner/repository pull request #123" \
    --review-base-revision <full-40-hex-comparison-base-sha> \
    --review-revision <full-40-hex-head-sha> \
    --diff-file /tmp/change.diff \
    --files-metadata /tmp/pull-request-files.json \
    --profile multi-lens-review-v1
```

The database URL stays in the environment so it is absent from argv and shell
history. Reusing a `--correlation-id` reconnects to the same Absurd task.
Completed `ctx.step` calls replay from Postgres after a crash or orchestration
retry; their values are small task IDs or artifact references, never patch or
topic bodies. The final Absurd result follows the same rule: it stores accepted
task IDs, attempt numbers, output CIDs, the planner artifact CID, and bounded
trusted accounting—not copies of the accepted output bodies. The CLI hydrates
the verdict directly from MoltNet only after the durable task completes.

If a prior run reached a terminal child-task failure, start a new durable run
with a new correlation and supply any accepted work through
`--planner-task-id`, `--preflight-task-id`, and repeatable
`--topic-task-id`. Trusted code requires each referenced task to be completed
and accepted in the same team and diary. It revalidates the exact manifest,
review revision, topic artifact CID, lane set, structured output, and—when
configured—runtime profile before accepting the result. Missing, failed, and
cancelled phases are created normally. This preserves expensive agent work
without copying output bodies into Absurd or trusting local state.

On a terminal orchestration failure, CLI cleanup cancels tasks that are still
unclaimed but lets already-dispatched or running agents finish. Their accepted
outputs can therefore be named in the recovery run instead of being destroyed
by a cancellation race.

Retrying a terminal Absurd task alone replays the same checkpointed child task
IDs. That is correct for crashes and transient orchestration failures, but it
cannot repair a MoltNet child task that is itself terminal; use an explicit
accepted-phase reference so the replacement remains visible and auditable.

Profile routing remains backward compatible:

- `--profile` is the default for every task;
- `--lens-profile <lane>=<profile>` and `--synthesis-profile <profile>` keep
  their existing meanings;
- the legacy `test-coverage` lane is normalized to `tests`, while
  `DEFAULT_LENSES` retains its original four-value public contract;
- `--lane-profile` and `--global-synthesis-profile` are explicit aliases; and
- `--planner-profile` and `--preflight-profile` route the planning phases; and
- the legacy `--topic-reducer-profile` now supplies the default combined
  topic-review profile when no lane-specific override is present.

By default, every applicable lane for a topic runs in one bounded review task.
Lane overrides group lanes by resolved profile, so a topic is split only when
its lanes genuinely require different runtimes. Trusted code rejects profile
routing that would exceed 12 total topic-review tasks. Child tasks have one
attempt; model-turn and output budgets belong in the curated runtime profiles
rather than being multiplied by orchestration retries.

Names resolve once against team-scoped runtime profiles before workflow spawn;
task-service enforces the resolved immutable ids through `allowedProfiles`.
For large reviews, route `--planner-profile` to a fast, high-context model with
reliable structured output; reserve deeper profiles for topic review and
global synthesis.

Model selection, injected context, and the planner's bounded-worktree runtime
policy require deliberate curation. See
[Planner curation](./PLANNER-CURATION.md) for the workload contract, profile
criteria, policy surface, and acceptance learnings.

The planner profile must expose Pi's `read`, `grep`, `write`,
`moltnet_upload_task_artifact`, and bounded read-only Git inspection through
the effective shell policy. It runs in a detached worktree at the exact review
revision, with the exact comparison base in its brief. Git is limited to exact
changed-file evidence; scratch tools are limited to coverage accounting, budget
arithmetic, and JSON validation. The planner uploads
`review-topic-plan.v1.json` and includes the returned task-artifact CID in
`submit_freeform_output.artifacts[]`.
Attempt `outputCid` metadata is not a substitute for this explicit artifact.
The preflight profile must expose `moltnet_list_task_artifacts` and
`moltnet_download_task_artifact`. It lists the accepted planner task's uploaded
artifacts, selects the unique versioned topic-plan artifact, and downloads that
explicit CID through the task-artifact API. It does not need to reconstruct the
accepted attempt through `moltnet_get_task` plus
`moltnet_list_task_attempts`, and an attempt `outputCid` is not a task-artifact
CID.

Preflight is deliberately bounded. For planned changes it receives only the
manifest reference plus the accepted planner artifact. Planner-generated
candidates are advisory and cannot remove a file; preflight has no exclusion
field or classification authority. For deterministic small changes it receives
only the compact manifest and inspects the listed files in the exact-revision
worktree. No complete reviewable patch payload is uploaded before the trusted
plan is accepted. The worktree supplies bounded changed-file and surrounding
context; it is not an invitation to inventory or execute the repository.

## GitHub Actions

[`multi-lens-review.yml`](../../.github/workflows/multi-lens-review.yml)
preserves the `pull_request_target` trusted-base checkout and runs only for
`ready_for_review` or an `@legreffier /multi-lens-review` mention from an owner,
member, or collaborator. The prepare job fetches the raw diff and paginated
file metadata. Two ephemeral workers remain available through the staged
planner/preflight/canary gates and drain the correlation. Trusted synthesis
cannot weaken a topic recommendation or omit any blocker or major finding.
The final marker-backed comment renders completed findings, pivot rationale,
or questions, plus topic, coverage, artifact, task, and token diagnostics.

Local `act` runs never publish or update a PR comment.

## Provision the review runtime

Provisioning is an operator action. Follow
[Running Agents → Runtime Profiles](../../docs/operate/running-agents.md#runtime-profiles)
and
[Agent Security → Managing tool policies](../../docs/understand/agent-security.md#managing-tool-policies).
The read-only policy currently requires the reviewed `git` surface documented
in #1725.

## License

AGPL-3.0-only
