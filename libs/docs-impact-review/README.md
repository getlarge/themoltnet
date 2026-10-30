# @moltnet/docs-impact-review

Documentation-impact reviewer for pull requests
([#2373](https://github.com/getlarge/themoltnet/issues/2373)). It answers one
question: **does this PR leave users, operators, or contributors with missing
or incorrect instructions?** It is not a correctness, security, style, or
general docs review.

This library is the reviewer. It runs as the docs lane of the
[adaptive review](../adaptive-review/README.md), which decides when a pull
request needs it, supplies the task budgets and runtime profile, and publishes
its findings.

## Pipeline

```mermaid
flowchart TD
  ingest["Trusted ingest — no model<br/>git diff, base .gitattributes, base config<br/>tests, generated, binary listed by name"]
  ingest -->|no source or docs changed| nn0(["not-needed · 0 tasks"])
  ingest -->|source changed| extract["Stage 1 · extract<br/>tool-less task<br/>contract changes, evidence, search terms"]
  ingest -->|docs changed only| retrieval
  extract -->|no contract change and no docs changed| nn1(["not-needed · 1 task"])
  extract --> retrieval["Trusted retrieval — no model<br/>changed docs › routing map › search › nearest README<br/>at most maxDocs docs (6), excerpts at head"]
  retrieval --> coverage["Stage 2 · coverage<br/>worktree at head, ≤ 4 read-only tool calls<br/>missing or incorrect docs"]
  retrieval -->|PR adds docs text| check["Stage 3 · docs check<br/>tool-less task, runs beside coverage<br/>keep, rewrite, or remove each added hunk"]
  coverage --> resolve["Trusted resolution"]
  check --> resolve
  resolve --> outcome(["covered · updates-needed · not-needed · incomplete"])
  resolve -->|stage failure| failed(["failed · no outcome"])
```

Any coverage gap turns a clean outcome into `incomplete`; the report keeps
the clean outcome as `reviewedOutcome` and the comment says what the review
found for the part it read. A docs-check failure is recorded as a gap while
the coverage result stands. Trusted code
validates every stage output strictly: evidence must cite changed files,
findings must reference a known change (or `docs:<changed doc>` for a
contradiction in a doc the PR edits), and `incomplete` can only be decided by
trusted code, never by the model.

## Budgets

Defaults live in `DEFAULT_BUDGETS`. A repository overrides any key marked
configurable under `budgets` in its
[configuration file](#repository-configuration).

| Budget                               | Key                      | Default    | Configurable range |
| ------------------------------------ | ------------------------ | ---------- | ------------------ |
| Diff bytes (stage 1)                 | `diffTotalBytes`         | 64 000     | 8 000 – 256 000    |
| Per-file block bytes (header incl.)  | `diffPerFileBytes`       | 12 000     | 1 000 – 64 000     |
| Diff bytes reserved for changed docs | `diffDocsReserveBytes`   | ¼ of total | 0 – 128 000        |
| Docs-diff bytes (coverage stage)     | `docsDiffBytes`          | 16 000     | 1 000 – 64 000     |
| Excerpt bytes per doc                | `docExcerptBytes`        | 8 000      | 1 000 – 32 000     |
| Docs per review                      | `maxDocs`                | 6          | 1 – 20             |
| Docs hunks checked                   | `maxDocsHunks`           | 12         | 1 – 50             |
| Running timeout per stage (s)        | `stageRunningTimeoutSec` | 120        | 30 – 180           |
| Manifest lines, bytes per docs hunk  | —                        | 150, 1 500 | not configurable   |
| Model turns / output tokens          | —                        | 6 / 4096   | runtime profile    |

The diff is packed in three steps, each skipping a file that does not fit:
changed docs up to `diffDocsReserveBytes`, then source (files a routing rule
names first), then the remaining docs in whatever budget is left. A large
source change therefore cannot push the pull request's own docs out of the
review. Every file left out is listed as a gap that names the budget key it
hit. The reserve defaults to a quarter of `diffTotalBytes` (16 000 bytes at
the default total), so a smaller total keeps room for source. Set
`diffDocsReserveBytes: 0` to pack source before docs as reviewers before
this change did.

The 180 s timeout ceiling keeps two chained stages (300 s dispatch plus the
running timeout each, 16 minutes at most) four minutes inside the reusable
workflow's 20-minute job, for checkout, ingest, polling, and the comment; a
test holds the limit and the workflow together. A larger
diff takes longer to read, so raise `diffTotalBytes` together with the
timeout, and check the run summary's per-stage timing first.

Byte budgets target ~24k input tokens per stage. Output tokens start above the
issue's 1.5k target because reasoning tokens count against the limit; tune it
from measured `outputTokens`.

## Timing

Every stage records server timestamps plus transcript markers, so poll delay
never skews the split:

| Field               | Span                                                                               |
| ------------------- | ---------------------------------------------------------------------------------- |
| `queueMs`           | task queued → claimed                                                              |
| `openMs`            | claimed → first heartbeat (`startedAt`)                                            |
| `setupMs`           | first heartbeat → `execute_start`: snapshot, worktree, VM resume, guest projection |
| `firstModelEventMs` | `execute_start` → first model text or tool call                                    |
| `modelMs`           | first model event → completed                                                      |
| `observedMs`        | client-observed create → terminal, including poll delay                            |

Polling defaults to 2 s. Faster polling trips the REST API's per-principal
read limit, shared with a daemon running as the same identity, and the SDK
then stalls on `Retry-After`.

## Runtime profile

Each stage runs as a freeform task under a read-only runtime profile created
once per team. MoltNet's adaptive docs profile is in `.github/runtime-profiles/`
and its tool policy in `.github/runtime-policies/`. Each stage task is tagged
`stage:<extract|coverage|docs-check>`, `pr:<n>`, and `revision:<head>`, and
shares one correlation id per PR.

## Repository configuration

A repository configures the review in `.github/docs-impact-review.json`. The
reviewer reads it from the pull request's **base** revision, so a pull request
cannot change the rules it is reviewed by. Without the file, the defaults apply
and the comment says so.

```json
{
  "budgets": {
    "diffTotalBytes": 96000
  },
  "docs": {
    "agentFacing": ["prompts/**"],
    "exclude": ["vendor/**"],
    "include": ["docs/**/*.rst"]
  },
  "instructions": "User-facing CLI docs live in docs/reference/.",
  "routing": [
    {
      "docs": ["docs/reference/cli.md"],
      "id": "cli",
      "paths": ["apps/cli/**"]
    }
  ],
  "version": 1
}
```

| Key                | Effect                                                                                                                                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routing`          | Maps code paths to the pages that document them. Nearest READMEs are found automatically, so list only pages a README would miss. Routed pages are required reading: if they overflow, the review reports a gap.                                                                                    |
| `docs.include`     | Files reviewed as documentation besides Markdown (`*.md`, `*.mdx`), for example `docs/**/*.rst` or `**/*.adoc`. Excerpts and docs-check sections follow Markdown headings, so other formats are reviewed without an outline. Nearest-README lookup stays `README.md`; route other pages explicitly. |
| `docs.exclude`     | Documentation that is never reviewed, searched, or selected. Added to the built-in `**/CHANGELOG.md` and `**/.*/**/CHANGELOG.md`.                                                                                                                                                                   |
| `docs.agentFacing` | Instructions written for agents (skills, prompts). They rank below user and operator docs unless the pull request changed them or a routing rule names them. Added to the built-in `.agents/**`, `.claude/**`, `.codex/**`, `.cursor/**`, `.pi/**`, `**/skills/**`, `**/.*/**/skills/**`.           |
| `budgets`          | Overrides for the configurable keys in [Budgets](#budgets). Each key is optional and must fall in its range. `diffPerFileBytes` and `diffDocsReserveBytes` may not exceed `diffTotalBytes` when the file sets them; a default above a smaller configured total is capped to it.                     |
| `instructions`     | Up to 2,000 characters of guidance added to every stage brief. It refines the review within its fixed scope and output format; it cannot change them.                                                                                                                                               |

The `docs` lists add to the built-in ones (`docs.include` has none); an empty
list adds nothing.

**Globs** (routing `paths`, `docs.include`, `docs.exclude`, `docs.agentFacing`) use Node's
[`path.matchesGlob`](https://nodejs.org/api/path.html#pathmatchesglobpath-pattern),
which follows minimatch syntax: `*`, `?`, `**`, `{a,b}` and `[ab]`. Paths are
relative to the repository root and always use `/`. Four pitfalls:

| Pitfall                                                                | Wrong                                           | Right                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| `*` and `**` never match a name starting with a dot                    | `**/CHANGELOG.md` misses `.github/CHANGELOG.md` | add `**/.*/**/CHANGELOG.md`, or `.github/**` for that directory |
| A pattern matches whole paths, not directories                         | `vendor` matches only a file named `vendor`     | `vendor/**`                                                     |
| Paths have no leading `/` or `./` (rejected)                           | `/docs/**`, `./docs/**`                         | `docs/**`                                                       |
| On macOS and Windows, wildcard parts ignore case; CI on Linux does not | `docs/*.MD` matches `docs/a.md` locally only    | match the case of the files: `docs/*.md`                        |

Good patterns:

```json
{
  "docs": {
    "agentFacing": ["prompts/**", "**/.*/**/prompts/**"],
    "exclude": ["vendor/**", "docs/generated/**", "**/*.snap.md"]
  },
  "routing": [
    {
      "docs": ["docs/reference/cli.md"],
      "id": "cli",
      "paths": ["apps/cli/**", "packages/cli/src/**/*.{ts,tsx}"]
    }
  ],
  "version": 1
}
```

A leading `!` (negation) and `\` are rejected, and a path segment may hold
at most three `*`: the matcher backtracks, so a segment such as `*a*a*a*a*b`
would take exponential time on a long file name.

Routing `docs` entries are exact paths, not globs, and routing `id`s must be
unique. A routing rule may not name a page that `docs.exclude` drops: the
configuration is rejected instead of silently losing a required route.

**Versioning.** The file declares `"version": 1`. Within version 1, new keys
are only added, never renamed or removed, and an unknown key is an error that
names it. A configuration using a key the pinned reviewer does not know yet
needs a newer reviewer.

An invalid configuration fails that pull request's review with a message naming
the file, the revision, and the keys to fix (the first five, and how many
more); other pull requests still run. So does any other per-pull-request
failure, such as a revision that cannot be fetched: its failed report is
written like any other, including to `--out`.

Mark generated code and docs with `linguist-generated` in `.gitattributes`
rather than in this file: the reviewer reads it from the base revision too.

This repository's own configuration is
[`.github/docs-impact-review.json`](../../.github/docs-impact-review.json). A
test fails when a routed page no longer exists.

When replaying pull requests whose base predates the file, pass
`--config .github/docs-impact-review.json` so the review uses the current rules.
