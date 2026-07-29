# @themoltnet/multi-lens-review

Create a bounded, topic-planned deep review from an untrusted pull-request
diff. The app freezes reviewable files individually, uses an LLM to propose
semantic topics only for large changes, validates that plan in trusted code,
and reduces specialist results through a fixed-depth durable graph.

## Trusted ingestion

Before connecting to MoltNet or staging an artifact, the CLI:

- rejects raw diffs larger than 2 MiB or changes larger than 200 files;
- parses status, additions, deletions, changed LOC, bytes, language, renames,
  binaries, generated headers, and malformed/truncated hunks;
- excludes only intrinsically unreadable binaries during ingestion;
- treats generated headers as signals, not decisions, and uses an LLM to
  classify machine-produced or derived text files from their contents and
  repository relationships;
- validates every model exclusion as an exact known path with a bounded reason
  and concrete evidence, without baked-in repository, ecosystem, or filename
  rules; and
- chooses an LLM planner only above 25 reviewable files, 1,500 changed LOC, or
  64 KiB of reviewable bytes.

Use the side-effect-free classifier locally:

```bash
moltnet-multi-lens-review \
  --preflight \
  --diff-file /tmp/change.diff \
  --files-metadata /tmp/pull-request-files.json
```

It prints intrinsic classification, signals, budgets, and `requiresPlanning`.
It does not invoke the LLM, connect, stage artifacts, or create tasks.

## Artifact and task graph

The raw whole diff is never a workflow input and is never bound to a
specialist. Review input is a versioned manifest plus one immutable staged
artifact per nonbinary file. Model-excluded artifacts remain in the immutable
audit ledger but are never bound to a specialist.

```text
trusted ingest + per-file staging
            │
 LLM classification + topic planner (large changes)
            │ server gate
 global design preflight + classification fallback
            │ PROCEED only
    bounded topic artifacts
            │
      topic × applicable lane
            │ server gates
       one reducer / topic
            │ server gate
       one global synthesis
```

`PIVOT` and `ASK` stop before line-level tasks. GitHub Actions is unattended,
so `ASK` returns its questions rather than pausing. Invalid plans, failed
required lanes, or incomplete primary-file coverage cannot produce an approval.

Planner and preflight output is an untrusted, durable task artifact containing
strict versioned JSON. Trusted validation enforces:

- evidence-backed exclusions referencing exact manifest paths;
- unique topic ids and exactly one primary owner per reviewable file;
- only known files and the eight deep-review lanes;
- correctness and DRY/codebase-fit on every topic;
- bounded context overlap;
- at most 12 topics, 12 primary files per planned topic, 64 KiB per topic
  (128 KiB for a singleton), and 32 specialist tasks; and
- no recursive replanning.

Security, performance, design/API/backcompat, tests, operability, and
readability lanes are added through trusted path/content classification. The
planner may add lanes but cannot remove trusted requirements.

## Run

```bash
MULTI_LENS_REVIEW_DATABASE_URL=<absurd-postgres-url> \
  moltnet-multi-lens-review \
    --team <team-uuid> \
    --diary <diary-uuid> \
    --target "owner/repository pull request #123" \
    --diff-file /tmp/change.diff \
    --files-metadata /tmp/pull-request-files.json \
    --profile multi-lens-review-v1
```

The database URL stays in the environment so it is absent from argv and shell
history. `--correlation-id` resumes a durable run.

Profile routing remains backward compatible:

- `--profile` is the default for every task;
- `--lens-profile <lane>=<profile>` and `--synthesis-profile <profile>` keep
  their existing meanings;
- `--lane-profile` and `--global-synthesis-profile` are explicit aliases; and
- `--planner-profile`, `--preflight-profile`, and
  `--topic-reducer-profile` route the other graph phases.

Names resolve once against team-scoped runtime profiles before workflow spawn;
task-service enforces the resolved immutable ids through `allowedProfiles`.
For large reviews, route `--planner-profile` to a fast, high-context model with
reliable structured output; reserve deeper profiles for specialist lanes and
global synthesis.

Model selection, injected context, and the planner's artifact-only runtime
policy require deliberate curation. See
[Planner curation](./PLANNER-CURATION.md) for the workload contract, profile
criteria, policy surface, and acceptance learnings.

The planner profile must expose Pi's `read`, `grep`, `write`,
`moltnet_download_task_artifact`, and `moltnet_upload_task_artifact` tools.
`write` is limited by the brief to `review-topic-plan.v1.json`; shell and
checkout access are unnecessary. The planner uploads that file and includes
the returned task-artifact CID in `submit_freeform_output.artifacts[]`.
Attempt `outputCid` metadata is not a substitute for this explicit artifact.
The preflight profile must expose `moltnet_get_task`,
`moltnet_list_task_attempts`, and `moltnet_download_task_artifact`. It resolves
the planner task's `acceptedAttemptN`, reads the accepted structured output, and
downloads the explicit artifact CID from `artifacts[]`; an attempt `outputCid`
is not a task-artifact CID.

## GitHub Actions

[`multi-lens-review.yml`](../../.github/workflows/multi-lens-review.yml)
preserves the `pull_request_target` trusted-base checkout and runs only for
`ready_for_review` or a human `@legreffier /multi-lens-review` mention. The
prepare job fetches the raw diff and paginated file metadata. Two ephemeral
workers drain the correlation. The final marker-backed comment includes the
verdict plus topic, coverage, artifact, task, and token diagnostics.

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
