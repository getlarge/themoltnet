# Retrieval evaluation

Private evaluation library for the production diary-entry repository search.
Unit tests do not start Docker or load a model. Run commands from the repository
root with Node and pnpm versions from `.tool-versions`.

## Fixture baseline

The frozen PR #2821 development fixture contains twelve entries and six queries.
All 72 entry/query pairs have binary judgments. Four weight settings, cutoffs
1/3/5 and two repeats produce 144 searches. Repeats check deterministic ordering;
they are not independent statistical samples. This is not a held-out benchmark.

The runner uses production migrations and `createDiaryEntryRepository().search()`
in disposable PostgreSQL/pgvector. It never reads `DATABASE_URL`. A transaction
freezes `now()`; batched access-metadata resets happen only after background
updates settle. The fixture preserves its original historical dates; remaining
entries use transaction time. No retrieval thresholds or production defaults are
changed. Precision uses k as denominator, including unfilled slots. Recall is
undefined for no-match queries. Reports retain false-positive and missed IDs.

Install Docker and cache `Xenova/e5-small-v2` with `config.json`, `tokenizer.json`,
`tokenizer_config.json` and `onnx/model_quantized.onnx`. Models are local-only;
missing models fail explicitly. The cache directory contains `Xenova/e5-small-v2/`.

Bash:

```bash
export NX_LOAD_DOT_ENV_FILES=false
export RETRIEVAL_MODEL_CACHE=/absolute/path/to/models
pnpm exec nx run @moltnet/retrieval-eval:eval
```

PowerShell:

```powershell
$env:NX_LOAD_DOT_ENV_FILES = 'false'
$env:RETRIEVAL_MODEL_CACHE = 'C:\models'
pnpm exec nx run @moltnet/retrieval-eval:eval
```

```bash
pnpm exec nx run-many -t lint test typecheck secretlint --projects=@moltnet/retrieval-eval
pnpm exec nx run @moltnet/retrieval-eval:test:integration
pnpm exec nx run @moltnet/retrieval-eval:eval --dataset=/path/to/frozen.json --workspace=/path/to/private/workspace
```

Private storage defaults to `~/.local/share/moltnet/retrieval-eval/themoltnet/`.
`RETRIEVAL_WORKSPACE` or `--workspace` overrides this path across checkouts.
Run snapshots, ordered rankings, model file/vector hashes, preparation/code hashes,
Git revision and dirty state, database/function identity and time policy are
retained. Each trial checkpoints before continuing; failed runs retain evidence.
Embedding caches are disposable and keyed by text, preparation and model hashes.

New corpus datasets use `relative-capture-v1`: entry ages at capture translate
to each transaction's clock. The fixture's `historical-fixture-v1` remains a
separate protocol. Related query families must remain in one split. Preserve
entry/query hashes with judgments; edits invalidate affected judgments.

Grades are 2 **Answers**, 1 **Supports**, 0 **Not relevant**; missing means
**Not reviewed**. Precision is withheld when any returned item within k is
unreviewed. Answer precision counts grade 2; useful precision counts grades 1–2.
Recall and verified no-match claims require complete corpus judgments. Saved
rankings can be rescored against new label revisions only when search inputs
are unchanged. Old reports retain their original snapshots.

## Corpus preparation and Potato review

Potato is the annotation UI. The library retains private workspace revisions,
sanitization, local screening, approval checks and dataset freezing without a
browser server. Task templates and operator tooling are supplied by the next
layer of the PR stack; this library exposes the corpus-decision and
relevance-judgment interchange contracts below.

```bash
pnpm exec nx run @moltnet/retrieval-eval:workspace -- --init --workspace /private/workspace
pnpm exec nx run @moltnet/retrieval-eval:workspace -- --import /private/capture.json --workspace /private/new-workspace
pnpm exec nx run @moltnet/retrieval-eval:workspace -- --action /private/action.json --revision 0 --workspace /private/workspace
pnpm exec nx run @moltnet/retrieval-eval:workspace -- --freeze --revision 1 --workspace /private/workspace
```

Actions use the WorkspaceStore contract (edit, decision, query, judgment).
They require the current revision, reject stale writes, and reset affected
judgments on content changes. Only approved entries are frozen. Existing private
workspace files remain readable; removing the UI does not remove stored drafts,
annotations or source mappings. Local Nimble screening remains available through
`screenEntry`; screening is advisory and does not approve entries.

CLI rescoring (no Docker or embedding inference is performed):

```bash
pnpm exec nx run @moltnet/retrieval-eval:eval --dataset=/path/to/new-label-snapshot.json --rescore=/path/to/runs/id/run.json
```

Storage layout:

| Directory     | Purpose                                                                                 |
| ------------- | --------------------------------------------------------------------------------------- |
| `revisions/`  | Immutable numbered workspace revisions, including private mappings and sanitized drafts |
| `datasets/`   | Immutable approved snapshots                                                            |
| `screening/`  | Private local-classifier inputs, rubric and results                                     |
| `runs/`       | Frozen datasets, per-trial checkpoints and original reports                             |
| `reports/`    | New reports from compatible label revisions                                             |
| `embeddings/` | Disposable text/preparation/model-keyed cache                                           |

Files use mode 0600 and created directories mode 0700. Revision publication is
atomic and refuses to overwrite a concurrent winner; reloading resolves a stale
revision without silently merging decisions. Previous revisions remain available
for recovery. A new checkout using the same workspace path reopens these files.

The original temporary UI and 300-entry diary capture were not recovered. The
starter is explicitly synthetic, with a fresh capture version; it does not claim
to reproduce that missing sample. Imported datasets should record capture time,
sampling strategy, population/sample sizes and capture version in provenance.
No private diary data is committed by this library.

`test-ci` uses the repository’s Nx Cloud atomized-test convention. Run `test`
locally; CI selects the same eight unit files and excludes integration suites.
An optional `--source-map=/path/to/private-map.json` on import preserves an
entry-ID-to-source-ID mapping privately; it is never included in exports.

## Verified fixture results

The October 27, 2026 integration on current main reproduced PR #2821's recorded
summary, with all 144 searches complete and zero ordered-result differences
between repeats. Means below cover the five answerable queries.

| Weights      | P@1 / R@1   | P@3 / R@3    | P@5 / R@5   |
| ------------ | ----------- | ------------ | ----------- |
| Relevance    | 1.00 / 0.60 | 0.60 / 1.00  | 0.36 / 1.00 |
| + Recency    | 1.00 / 0.60 | 0.467 / 0.80 | 0.28 / 0.80 |
| + Importance | 0.80 / 0.50 | 0.40 / 0.70  | 0.32 / 0.90 |
| + Both       | 0.80 / 0.50 | 0.467 / 0.80 | 0.28 / 0.80 |

The synthetic no-match query still returns 1/3/5 unwanted results at those
cutoffs under every setting. Harness correctness does not establish acceptable
retrieval quality; threshold tuning and graded ranking metrics remain deferred.

## Potato judgment roundtrip

Use `potato` to prepare a task from an approved, sanitized dataset and saved
rankings. The immutable manifest freezes the dataset snapshot and maps each
Potato item to one query/entry pair with both content hashes. By default the
queue is the deduplicated union of the first ten results per configuration.
Use `--full-corpus` to review missed answers outside those candidates.

```bash
export NX_LOAD_DOT_ENV_FILES=false
umask 077
pnpm exec nx run @moltnet/retrieval-eval:potato -- \
  --dataset /private/dataset.json --run /private/run.json \
  --output /private/potato-manifest.json
jq -c '.items[]' /private/potato-manifest.json > /private/items.jsonl
```

In PowerShell, set `$env:NX_LOAD_DOT_ENV_FILES = 'false'` and invoke the command
on one line. Keep all output files in the private workspace. The CLI checks
Secretlint before saving; it does not replace local screening or human approval.

Configure Potato's item ID field as `id`, display `query` and `content`, use a
`relevance` radio scheme with exactly `Answers`, `Supports`, `Not relevant`,
and a required `reason` text scheme. Keep the manifest with the task and never
edit reviewed item text in place. Re-prepare after changing inputs.

Export ordinary human annotations as JSONL from Potato and select the reviewer
explicitly. Solo generated cases, model predictions and aggregated gold exports
are separate evidence and are not inputs to this adapter.

```bash
pnpm exec nx run @moltnet/retrieval-eval:potato -- \
  --dataset /private/dataset.json --manifest /private/potato-manifest.json \
  --annotations /private/annotations.jsonl --reviewer reviewer \
  --run /private/run.json --output /private/import-report.json
jq '.dataset' /private/import-report.json > /private/labelled-dataset.json
```

The report contains the revised dataset, import receipt (reviewer and input
hashes), and metrics from saved rankings when `--run` is supplied. Grades map to
2/1/0; absent decisions remain unknown. Only supplied judgments replace existing
pairs. Conflicting or duplicate rows from the selected reviewer, unknown IDs,
stale snapshots and missing reasons fail the entire import. Other reviewers are
not aggregated. Re-importing identical labels does not increment the revision.
Outputs cannot overwrite existing files. Retain the original JSONL and manifest
alongside the report; receipt hashes use the library's SHA-256 of JSON encoding.
No search, database, model or hosted-task mutation runs during the roundtrip.

For later scoring, use the normal `eval --dataset /private/labelled-dataset.json
--rescore /private/run.json` command. Incomplete cutoffs still withhold precision;
corpus-wide recall and no-match verification require full corpus judgments.

## Potato corpus decision roundtrip

Before review, bind the actual task `items.jsonl` to the capture workspace. Each
item must contain `id`, `title`, `content` and `contentHash` matching the saved
capture. Display-only screening and model suggestions are not in the manifest.
Keep this immutable manifest with the task export; do not reconstruct it from
edited task content after review.

```bash
export NX_LOAD_DOT_ENV_FILES=false
pnpm exec nx run @moltnet/retrieval-eval:workspace -- \
  --workspace /private/capture --potato-items /private/task/items.jsonl \
  --output /private/corpus-manifest.json
```

Export ordinary human annotations as JSONL from Potato. Preview one reviewer
against the current workspace revision (shown by `workspace --workspace PATH`):

```bash
pnpm exec nx run @moltnet/retrieval-eval:workspace -- \
  --workspace /private/capture --revision 0 \
  --potato-manifest /private/corpus-manifest.json \
  --annotations /private/corpus-annotations.jsonl --reviewer reviewer
```

The receipt reports approvals, pending edits, exclusions and unreviewed rows.
Repeat with `--apply` to publish one atomic workspace revision. Any invalid row,
stale content, conflicting draft, model-origin record or detected secret blocks
the entire batch. Existing revisions remain recoverable; an identical import
is a no-op. Keep original exports privately alongside the manifest. Reviewer,
input hashes, topics and notes are retained in workspace `corpusReviews`, not
in the frozen public dataset. Topics are review notes, not automatic entry tags.

- **Approve unchanged:** approves the exact manifested copy. A changed text-edit
  value contradicts this decision and is rejected.
- **Needs editing:** stores a proposal as a pending draft, or preserves notes
  describing a title/context change. It does not replace content or grant approval.
- **Exclude:** excludes the copy from future frozen snapshots.
- **No decision:** leaves existing state unchanged.

For edits, apply the reviewed replacement through the workspace `edit` action,
which scans text, changes its hash, invalidates affected judgments and resets
approval. Screen the changed copy again and prepare a fresh manifest/task for
human approval. Existing drafts must be resolved before a conflicting import.
Do not automatically convert notes into content changes.

After import, `workspace --freeze --revision N` creates an immutable dataset
containing approved copies only. It does not upload or publish anything. The
relevance importer above is a different stage: it grades query/entry pairs
against that approved dataset and can rescore saved rankings.

### Human annotations with engine provenance

With the pinned Potato environment, export the ordinary per-reviewer format:

```bash
python -m potato.export --config /private/task/config.yaml \
  --format jsonl --output /private/task/exports/review-v1
```

Use the resulting `annotations.jsonl`, not the engine's resolved `labels.jsonl`.
Keep a private copy of the task's `annotation_output`, original items and model
suggestion/provenance sidecars with the export. This preserves accepted/overridden
suggestions without publishing task data or changing existing review sessions.

Potato's ordinary per-reviewer JSONL includes `engine_request` even for human
answers submitted through the normal queue (`purpose: organic`). This field is
provenance, not evidence that a model supplied the final answer. Both importers
validate its purpose, visibility, split, request ID and sampling probability;
explicit machine annotator origins and machine-resolved exports remain rejected.
Corpus reviews retain it in the private workspace; relevance imports retain it
in the receipt. A `shown` answer is assisted review and must not be counted as
blind calibration evidence. Keep the original export and native behavioral
records to distinguish accepting a suggestion from overriding it.

### Explore queries before admitting them

Create a separate dataset snapshot from the approved corpus with proposed
queries, development-family assignments and no verified judgments. Running
search does not admit those queries to the benchmark or approve their suggested
answers. Inspect rankings, revise queries, then freeze the selected inputs and
review relevance. Keep all related query variants in one split.

```bash
pnpm exec nx run @moltnet/retrieval-eval:eval -- \
  --dataset /private/exploratory-dataset.json --workspace /private/exploration \
  --top-k 10 --repeats 2
```

This runs each query under all four weight configurations and checks repeatable
rankings. The optional flags select one cutoff and the repeat count; omitting
them preserves the baseline's cutoffs 1/3/5 and two repeats. Ten queries with the
above settings produce 80 searches. Saved rankings can supply the deduplicated
candidate queue before any verified relevance labels exist. Precision remains
incomplete and recall remains withheld until their judgment requirements hold.
