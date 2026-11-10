# Approved diary corpus v1

Use this checked-in dataset to test the production diary retrieval code locally
on real, human-approved diary text. It contains **276 entries and seven development
queries**. A checkout is sufficient to obtain the data; no Potato account,
production database, diary credentials or private workspace is needed.

From the repository root, install dependencies, start Docker and configure the
local E5 model cache as described in the [runner README](../../README.md#fixture-baseline).
Then run:

```bash
export NX_LOAD_DOT_ENV_FILES=false
export RETRIEVAL_MODEL_CACHE=/absolute/path/to/models
pnpm exec nx run @moltnet/retrieval-eval:eval:corpus
```

In PowerShell, use `$env:NX_LOAD_DOT_ENV_FILES = 'false'` and
`$env:RETRIEVAL_MODEL_CACHE = 'C:\models'` before the same Nx command.

This runs 56 searches: seven queries, four weight configurations, top ten,
and two repeats. The runner starts disposable PostgreSQL/pgvector, applies
production migrations, and records rankings and repeatability evidence.
Outputs default to `~/.local/share/moltnet/retrieval-eval/themoltnet/`; append
`--workspace=/absolute/path/to/runs` to the command to choose another location. Normal unit tests validate the snapshot without
starting Docker or loading an embedding model.

To add or revise queries and create your own local Potato tasks, follow
[Try your own queries locally](../../potato/LOCAL.md). It covers query drafts,
retrieval, exploration, grouped relevance review, and importing your judgments.

## Execution verification

On November 10, 2026, a fresh macOS run completed all 56 searches with zero
ordered-result differences between repeats. It used Node 24.14.1, the local
E5-small-v2 q8 model, and disposable PostgreSQL 16.15 with production migrations.
Run `4a7f110c-e8f4-4e3f-87a1-eb112580d55a` records source revision
`d1c87924f984cf296d9c7e402e1140e483626896` with uncommitted test/README changes;
retrieval source and dataset were unchanged. Its dataset hash is
`8ad499a86dc54e42b8a7f9d313609ede778c441a79d005ed1565751b232e7ac1`.
This verifies execution and repeatability, not retrieval quality.

## Files and current readiness

- `dataset.json` is the runner's versioned dataset contract, including entry and
  query hashes, capture timestamp, sampling provenance and relative-age policy.
- `information-needs.json` explains what would satisfy each query. It is reviewer
  context, not an answer key or a set of relevance judgments.

**Relevance judgments are not complete.** This first release deliberately has
an empty `judgments` array. It is ready for running retrieval, inspecting results
and checking the harness; it cannot yet establish precision, recall or which
configuration retrieves the best answers. Unknown entries are not negatives.
The completed annotation round will supply a new label revision with the same
entry/query hashes, allowing compatible saved rankings to be rescored.

The historical twelve-entry fixture remains the labelled regression baseline.
Do not replace its assertions with expectations inferred from this corpus's
unreviewed results.

## Provenance and scope

The capture on 2026-10-29 sampled 300 entries from a population of 7,932 using
seeded round-robin sampling by entry type, primary scope and quarter. Human
corpus review retained these exact 276 sanitized derivatives. The corpus owner
approved sharing the accepted entries on 2026-11-02. This is a new capture,
not the previously missing 300-entry snapshot; pagination was not a transactional
snapshot, and original entry signatures do not authenticate sanitized copies.

Seven queries were retained after human exploration. Three dropped queries and
the deferred documentation-writing query are excluded. All seven belong to the
development split: this is exploratory data, not a held-out quality benchmark.
Entry ages relative to capture time are preserved in every trial through
`relative-capture-v1`.

The release contains approved entry text and public evaluation metadata only.
Private source mappings, reviewer accounts, screening records, model suggestions
and Potato's operational state are not part of this dataset.

Keep this snapshot stable. Content or query changes need a new dataset version;
annotation updates need a new label revision. Use the
[Potato judgment importer](../../README.md#potato-judgment-roundtrip) to validate
reviewer exports against the matching manifest before adding judgments.
