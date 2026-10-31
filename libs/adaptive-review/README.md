# Adaptive review policy

Adaptive review reads `.github/adaptive-review.json` from the pull request's
**base commit**. A repository opts in by adding a version 1 JSON file on its
base branch. A PR adding or changing the policy is reviewed under the old base
policy; the new policy takes effect after merge. A missing file skips adaptive
review. An invalid file fails the review configuration step.

```json
{
  "checks": [],
  "lanes": ["tests"],
  "rules": [],
  "version": 1
}
```

`lanes` is a nonempty, unique subset of `docs`, `tests`, `conventions`,
`security`, `blast-radius`, `performance`, and `complexity`. The two score questions remain
part of each classifier task. Only enabled lanes may start specialist tasks.

The `performance` lane investigates introduced latency, CPU, memory, I/O, and
resource-retention regressions using the existing focused profile and worker
pool. It traces the affected caller and workload, checking bounds, batching,
pagination, caching, indexes, and cleanup before raising a concern. A new
query per item replacing a batch query is a useful investigation target;
a bounded loop or an unmeasured micro-optimization is not by itself a defect.
Missing workload or measurement evidence remains `unclear`. Reviewers inspect
code and existing measurements; they do not execute the PR or run benchmarks.
Enable `performance` in the base policy after adopting a runtime release that
supports it. No additional runtime profile or tool permissions are required.

Rules provide `id`, `description`, `kind` (`mechanical` or `semantic`), `paths`,
and `source`. Descriptions are the governing policy text. Sources are citations
for humans, not instructions for reviewers to load from the PR head. A check
points at a rule with `ruleId`; its hit is a candidate for a focused review,
not a finding. Checks have `id`, `kind`, `paths`, optional `excludePaths`, and
`detail`. The supported kinds are:

- `changed-path`: a matching path changed, including deletion or rename.
- `added-line`: a matching retained patch has an added line matching the
  RE2-compatible `pattern`. Missing or summarized content is marked unknown.
- `missing-companion`: a matching source changed without a matching added or
  modified file in `companionPaths`. A deleted companion does not count.

Globs are root-relative, case-sensitive POSIX paths. A `*` matches within one
path segment and `**` matches zero or more segments. Dotfiles are matched by
wildcards. Negation, braces, character classes, parent traversal, and absolute
paths are not supported; use `excludePaths` for exclusions. Rule and check
lists are bounded and validated before routing. These globs differ from the
docs impact review's, which use minimatch and skip dot names.

Optional `docs.config` and `complexity.rubric` are root-relative paths to
base-commit JSON files for their enabled lanes. They do not select runtime
code, commands, credentials, providers, or worker profiles. The caller workflow
owns those capabilities.

The reusable workflow lives in the MoltNet runtime repository. A caller
supplies its review profiles, model provider, and protected paths. Its own PR
base supplies this policy and any referenced docs or complexity JSON. The
reviewer fetches the pinned head as Git data and reads `git diff base...head`;
it never runs code from the head. The full name/status manifest includes
deletions and both sides of renames even when patch evidence is summarized.
The policy and reference digests, PR revisions, and runtime SHA are checked
again before a comment is published. The PR head and base are read once more
after the comment is written. If either moved, the comment is replaced with a
stale notice, and the publish step fails.

## Repository review guidance

Add a `REVIEW.md` to your repository's base branch to tell reviewers what
matters in your project. No additional JSON configuration is needed once
adaptive review is enabled. For example, a root `REVIEW.md` can contain:

```markdown
# Review criteria

- Check the intended behavior against the PR's acceptance criteria.
- Report introduced defects with a concrete trigger, consequence, and file/line.
- For API changes, check compatibility with existing callers and error handling.
- Leave formatting and lint violations to automated checks.
- State what evidence is missing when a conclusion cannot be established.
```

Root guidance applies throughout the repository. Add a nested file, such as
`libs/auth/REVIEW.md`, for criteria that apply only to that directory and its
descendants. More specific guidance refines broader guidance within its scope.
Both the old and new paths of a rename select applicable guidance. Keep the
criteria self-contained: the loader does not expand links or includes, or load
`AGENTS.md` as review guidance.

Only guidance committed at the PR's pinned **base revision** is trusted.
Adding, editing, or deleting `REVIEW.md` in a PR changes future reviews after
merge; it cannot replace that PR's review criteria. Working-tree copies are
not read. Each loaded file's SHA-256 digest is recorded with the review's
reference digests and included in the policy snapshot used for freshness
checks before publication.

The classifier receives guidance matching its packet's paths. Specialist
tasks receive guidance matching the full changed-path manifest, including
deletions and rename sources, with instructions to respect each file's scope.
This covers the tests, conventions, blast-radius, performance, security, docs, and complexity
lanes, including their freeform stages and semantic repairs. Standalone docs
and complexity workflows do not gain this behavior. Guidance supplies review
criteria; it cannot change enabled lanes, output contracts, security procedures,
or tool and runtime capabilities.

When enabling guidance, update existing deployed review profiles to match the
current templates, or adjust custom instruction prefixes to distinguish trusted
base criteria from untrusted reviewed content. In particular, the `docs-review`
template makes this distinction; updating the template in the runtime does not
automatically update a deployed profile.

Files must be named exactly `REVIEW.md` and be regular Git blobs containing
UTF-8 text without NUL bytes. Symlinks and `REVIEW.md` submodule entries are
rejected; submodules are not traversed. Limits are 16 KiB per file, 128 files,
and 128 KiB total across the base repository, including guidance outside the
changed paths. Invalid or oversized guidance fails configuration rather than
being silently truncated. A repository without guidance keeps the built-in
review criteria.

Tests cover base-revision loading, scope selection, validation, digest tracking,
and delivery into task inputs using mocked workers. They do not measure whether
a live model follows the criteria or whether guidance improves finding quality.

## Optional diary context

Focused reviewers (`tests`, `conventions`, `blast-radius`, and `performance`) can search
selected diaries for past decisions and incidents. This is **off by
default**. An operator enables it in the trusted caller workflow with
`focused-diary-ids` and a matching knowledge review profile; the repository's
`.github/adaptive-review.json` cannot grant diary access. Follow the
[runtime policy setup](../../.github/runtime-policies/README.md#optional-diary-context-for-focused-reviews)
for provisioning, release requirements, caller inputs, and deployed validation.

The workflow loads a review-owned runtime module into focused workers only.
The worker identity must already have read access to the selected diaries.
The host enforces the source list and a shared budget of eight search/fetch
attempts per toolset context. Source access covers whole diaries, not just
entries associated with this repository. The ordinary runtime and other
review profiles do not gain diary capabilities.

Diary entries guide investigation; findings still need evidence from current
code. Closure outcomes recorded below are unverified observations, not judgments
of correctness. The profile instructs reviewers to keep private diary contents
out of public findings, but does not automatically redact model output. Local
builds and mocked tests do not establish deployed access or finding quality;
validate the enabled configuration with a controlled workflow run.

## Findings and outcomes

Findings that cite a changed line are published as review threads, one per
finding, anchored to that line on the reviewed head. Each thread asks the
author to fix the finding or resolve the thread with a reason; with "require
conversation resolution" on the branch, that answer becomes part of merging.
A finding is identified by its lane, side, line, and path. Before posting, the
run reads the reviewer's existing threads and their state:

- An open thread at the same location covers the finding, so a re-run or a
  push that leaves the finding in place does not repeat it.
- A resolved thread at the same location is not reopened. The summary lists
  the finding and notes that an earlier thread on that line was resolved, so a
  new concern at a settled line stays visible without arguing the old one again.
- A finding that moved with the diff gets a new thread unless a focused
  reviewer identifies it as the same concern in an existing open thread on
  the same path. That continuing concern links to the earlier thread and
  appears in the summary with its current citation.

Each thread's hidden marker also carries the producing workflow run and the
review correlation ID. Threads are posted only after the last check that the
pull request still points at the reviewed head. If the head or base moves
while publishing, the summary is replaced with a stale notice and this run's
threads are deleted.

The summary comment starts with the number of findings and how many were
posted, were already open, or are listed in the summary. It lists up to 30
findings and points at the workflow run's report for the rest. If GitHub rejects the review (for
example, an anchor outside the diff), the publish step warns, lists the
findings in the summary, and succeeds. Set the caller input
`inline-findings: 'false'` to keep every finding in the summary comment.

Confirmed security findings are published like every other lane's: each
thread states the severity, the title, and how the change is reachable, with
the remediation as its suggested action. A pull request is unmerged code, so
its review findings are not embargoed.

### Earlier findings on subsequent reviews

On a later review, the `tests`, `conventions`, `blast-radius`, and `performance`
lanes receive earlier marked findings opened by the same reviewer App on that
PR. The summary's **Previous open findings** section reports assessments for
threads open when review started, against the current pinned head. Use each
thread link and explanation to decide whether to fix the concern or resolve
the thread with a reason.

| Status                                  | Meaning                                                                                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `still_present` — Still present         | The reviewer concludes the concern remains, with current code evidence. It can remain present even without a current changed-line anchor for an inline finding. |
| `fixed` — Fixed                         | The reviewer explains what changed to address the concern.                                                                                                      |
| `incorrect` — Earlier finding was wrong | The reviewer explains why the original reasoning was wrong.                                                                                                     |
| `not_checked` — Not checked / uncertain | The reviewer lacks enough evidence, or this run could not assess the finding. This counts as incomplete coverage.                                               |

These are advisory reviewer conclusions. The workflow does not automatically
resolve, reopen, or reply to earlier threads. GitHub's resolved or outdated
flags, an absent diff hunk, and omission from new findings do not establish a
fix. Earlier discussion is untrusted evidence; reviewers are instructed to
inspect current code independently. Output validation requires one explained
assessment per supplied open finding, but does not verify that the explanation
is correct.

Each lane receives at most 20 earlier findings, prioritizing recent open
threads over resolved history. Finding bodies are limited to 4,000 characters.
Reply context includes only the last three eligible replies among the first
50 comments fetched, from the reviewer App or an owner, member, or collaborator,
limited to 1,000 characters each. This is not the complete discussion.

All retained open findings are accounted for in the workflow report. Those
beyond the context limit, in disabled or screened lanes, or in failed lanes
are `not_checked`; prior findings do not force a lane to run. The summary shows
up to 40 individual assessments and counts the rest. Resolved threads may
provide context but receive no assessment. Security, docs, complexity, and
summary-only findings are outside this reassessment. If fetching review
threads fails, the review stage fails rather than assuming no history exists.
Local tests use mocked reviewer output; they do not establish live assessment
accuracy.

### Outcomes when a pull request closes

When a pull request closes, the outcomes workflow
(`adaptive-review-outcomes-reusable.yml`) reads the reviewer's threads and
writes one signed diary entry per pull request, tagged
`review:adaptive-outcomes`, `repo:<owner/repo>`, `pr:<number>`, and one
`lane:<lane>` per lane with findings. For each thread it records what GitHub
shows, not a verdict:

- `resolved`, and who resolved it.
- `outdated`: a later commit changed the anchored line. This does not mean the
  concern was fixed, and a fix made elsewhere leaves the thread current.
- The latest reply from someone other than the reviewer.

Each finding also carries its thread ID and URL, the head it was raised on,
the workflow run and review correlation ID that produced it, and
`adjudication: "unverified"`. A person or an eval decides later whether a
finding was a true or false positive. The entry ends with a JSON block
(`version: 1`) holding this data for eval tooling.

The run records only the closure that triggered it. If the pull request was
reopened, pushed to, or closed again before the run started, it records
nothing and the run for the latest closure records instead. Runs for one pull
request do not overlap. A pull request with no threads writes nothing, and a
reopened pull request that closes again keeps its first entry. Findings
that cite no line have no thread and are not recorded.

The classifier is selected by the caller's profile. MoltNet uses Ollama Cloud
`clef:27b` through its issue-classifier-v2 profile; other repositories can select
another System One classifier without changing this library. Classifier
scores determine which enabled lanes receive deeper review. A classifier
failure routes every enabled lane for review. The report names the failed
packet and a diagnostic code, and the workflow log adds the classifier task ID.
A binary patch hides what changed, so it routes every enabled lane as
incomplete. Lockfile summaries and generated paths are deliberate and do not;
the report still lists them as not reviewed.

The route and review jobs watch the run's worker jobs. Once every worker that
could claim a task has exited, for example because it failed to start, the
waiting packet or lane fails with `worker-unavailable` instead of holding the
job until its timeout. If the job list cannot be read, the review waits on the
task budgets as before.

When a lane's review is incomplete, the comment lists what it could not assess
under "Not fully assessed". For the docs lane, these are the documents, hunks,
and stages the docs impact review reported as gaps. For the security lane,
they are the candidates verification could not resolve, each with its cited
line and the missing evidence, and each gap the hunt named when it reported
partial coverage. A failed lane names its diagnostic code and the task to
inspect. For the complexity lane,
the summary names the coverage gap or the number of rubric criteria it could
not assess, and each unassessed criterion follows with its rationale.

`task-budgets` is optional. Use a YAML block to override only the limits that
need to change for your selected profiles:

```yaml
task-budgets: |
  classifier:
    timeout: 2m
  focused:
    timeout: 12m
  security:
    timeout: 15m
  docs:
    timeout: 5m
  complexity:
    timeout: 5m
```

All fields are optional. `timeout` limits execution of **each task**, not the
whole review. `dispatch-timeout` limits the wait for a worker, and
`expires-after` bounds the task's total lifetime. Durations use positive whole
seconds, minutes, or hours (`90s`, `12m`, `1h`).

| Review       | Default execution timeout |
| ------------ | ------------------------- |
| `classifier` | 90s                       |
| `docs`       | 2m                        |
| `complexity` | 3m                        |
| `focused`    | 12m                       |
| `security`   | 15m                       |

Every review defaults to a 5-minute dispatch timeout and 1-hour expiry.
`focused` supplies defaults for `tests`, `conventions`, `blast-radius`, and `performance`;
each of those lane names also accepts its own overrides. Resolution happens
per field: built-in defaults, then `focused` overrides for its four lanes,
then the individual lane override. Unknown names, duplicate fields, invalid
durations, and expiry shorter than dispatch plus execution fail before tasks
are submitted.

```yaml
task-budgets: |
  focused:
    timeout: 10m
  tests:
    timeout: 8m
  security:
    dispatch-timeout: 10m
    expires-after: 2h
```

The resolved limits appear in the GitHub run summary and are pinned between
routing and review. Docs and complexity apply the caller's limits to every
stage; adaptive docs task limits take precedence over the docs policy's
`stageRunningTimeoutSec`. Standalone docs and complexity workflows retain
their existing defaults. Size overrides for the selected profiles and the
reusable workflow's job and worker deadlines: security has two sequential
tasks, and docs and complexity can have multiple stages.

The `mode` input decides which lanes run. In `active` mode, the classifier
routes each pull request and only the lanes it selects are investigated; the
summary marks the rest "screened, not investigated". In `shadow` mode every
enabled lane is investigated. MoltNet runs `active` on every pull request and
`shadow` on request: a comment of exactly `/review` on an open pull request,
from an owner, member, or collaborator, reruns the review on the current head
and investigates every lane. A comment from a bot never triggers it.

For a caller repository, add a `pull_request` workflow that invokes
`getlarge/themoltnet/.github/workflows/adaptive-review-reusable.yml` pinned to
the action bundle commit SHA from an `adaptive-review-action` release, with
`# adaptive-review-action-v0` as a comment for dependency updates. The workflow
receives your secrets, so prefer the SHA to the moving major tag. The caller
grants the calling job `actions: read`,
`contents: read`, and `pull-requests: write`, passes `secrets: inherit`, and names an
environment containing the MoltNet agent and provider keys. Pass at least a
classifier profile, a nonempty `providers` definition, and
profiles for each lane enabled in `.github/adaptive-review.json`.
For on-demand reruns, also trigger it on `issue_comment` with the same
commenter checks as MoltNet's caller. Leave `runtime-ref` empty so the runtime
is the pinned release commit itself.
`protected-paths` should list only files that run from the pull request's own
revision, which for a `pull_request` caller means the caller workflows. A pull
request that changes the review code is then reviewed by the released version,
and its changes are read only as data. MoltNet's own callers pin the latest
release the same way.
The prepare job applies the docs impact review's eligibility rules: it skips
fork and Dependabot pull requests, pull requests whose file list GitHub
truncated, and pull requests that change a protected path. Fork and
Dependabot pull requests are screened from the event before the runtime is
installed; the other rules need the file list and run in the installed CLI.
The job skips unless that check explicitly admits the pull request.
Only the prepare job prepares the runtime. At a release commit it runs the
tracked bundle; at any other commit it installs the workspace and builds the
action. It uploads the bundled
action with a digest output, and the route and review jobs set up Node,
download that bundle, and refuse to run it unless its digest matches.
For private repositories, bind workers to a private diary; the review report
does not require a public diary.
