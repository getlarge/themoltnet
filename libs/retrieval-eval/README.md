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
pnpm exec nx run @moltnet/retrieval-eval:eval -- --dataset=/path/to/frozen.json --workspace=/path/to/private/workspace
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
