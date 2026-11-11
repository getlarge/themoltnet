# Retrieval evaluation

Private evaluation library for measuring production diary-entry repository
search against a frozen, labeled dataset. The fixture baseline runs locally;
corpus collection and a Potato annotation interface are separate work. This
package does not tune production defaults or require deployed API credentials.

Run commands from the repository root with Node and pnpm versions from
`.tool-versions` and workspace dependencies installed (`pnpm install`).

## Fixture baseline

The frozen development fixture contains twelve entries and six queries.
All 72 entry/query pairs have binary judgments. Four weight settings, cutoffs
1/3/5 and two repeats produce 144 searches. Repeats check deterministic ordering;
they are not independent statistical samples. This is not a held-out benchmark.

Start Docker. The commands below download `Xenova/e5-small-v2` into
`apps/rest-api/models`, then run the baseline with that cache. Evaluation loads
models locally only; missing models fail explicitly.

Bash:

```bash
export NX_LOAD_DOT_ENV_FILES=false
pnpm exec nx run @moltnet/rest-api:download-model
export RETRIEVAL_MODEL_CACHE="$PWD/apps/rest-api/models"
pnpm exec nx run @moltnet/retrieval-eval:eval
```

PowerShell:

```powershell
$env:NX_LOAD_DOT_ENV_FILES = 'false'
pnpm exec nx run @moltnet/rest-api:download-model
$env:RETRIEVAL_MODEL_CACHE = Join-Path $PWD 'apps/rest-api/models'
pnpm exec nx run @moltnet/retrieval-eval:eval
```

To use a custom cache, download with
`node tools/download-embedding-model.mjs --cache-dir /absolute/path/to/models`
and set `RETRIEVAL_MODEL_CACHE` to that directory. It must contain
`Xenova/e5-small-v2/` with `config.json`, `tokenizer.json`,
`tokenizer_config.json` and `onnx/model_quantized.onnx`.

```bash
pnpm exec nx run-many -t lint test typecheck secretlint --projects=@moltnet/retrieval-eval
pnpm exec nx run @moltnet/retrieval-eval:test:integration
pnpm exec nx run @moltnet/retrieval-eval:eval -- --dataset=/path/to/frozen.json --workspace=/path/to/private/workspace
```

Unit tests do not start Docker or load a model. The integration test runs the
full fixture baseline and needs the same Docker and model-cache setup as `eval`.
The CLI accepts only `--dataset` and `--workspace`; omitting `--dataset` selects
the fixture. It prints the run ID, status and search count on success.

The runner uses production migrations and `createDiaryEntryRepository().search()`
in disposable PostgreSQL/pgvector. It never reads `DATABASE_URL`. A transaction
freezes `now()`; access-metadata resets happen only after background updates
settle. The fixture preserves its original historical dates; remaining entries
use transaction time. Precision uses k as denominator, including unfilled slots.
Recall is undefined for no-match queries. Fixture reports retain false-positive
and missed IDs.

## Run artifacts and reuse

Private storage defaults to `~/.local/share/moltnet/retrieval-eval/themoltnet/`.
`RETRIEVAL_WORKSPACE` or `--workspace` overrides this path across checkouts.
Each run writes `runs/<run-id>/run.json` with its dataset snapshot, status and
ordered rankings, then `metrics-<labelRevision>.json` with per-ranking scores and
repeat differences. Nonempty repeat differences fail the run. Model file/vector
hashes, preparation/code hashes, Git revision and dirty state,
database/function identity and time policy are retained. Each trial checkpoints
before continuing; failed runs retain evidence.

`codeHash` fingerprints the current TypeScript sources in this package
(including fixtures), database, diary-service and embedding-service, plus
`pnpm-lock.yaml`. `preparationHash` fingerprints embedding preparation sources
and the lockfile. These hashes include uncommitted file contents. The recorded
PostgreSQL search-function hash identifies the migrated SQL implementation.
Embedding caches are disposable and keyed by text, preparation and model hashes;
any lockfile change invalidates them, even for an unrelated dependency.

## Dataset and metric contracts

New corpus datasets use `relative-capture-v1`: entry ages at capture translate
to each transaction's clock. The fixture's `historical-fixture-v1` remains a
separate protocol. Related query families must remain in one split. Preserve
entry/query hashes with judgments; edits invalidate affected judgments.

Grades are 2 **Answers**, 1 **Supports**, 0 **Not relevant**; missing means
**Not reviewed**. Precision is withheld when any returned item within k is
unreviewed. Answer precision counts grade 2; useful precision counts grades 1–2.
Recall and verified no-match claims require complete corpus judgments. The
binary fixture metrics also require complete corpus judgments; they treat grades
1–2 as relevant. Corpus datasets do not emit the binary fixture metrics.

The exported `rescore()` function can score saved rankings against revised labels
without another search. It rejects changes to entries, queries, time policy or
capture time. There is no rescore CLI or annotation UI in this package. Reuse is
for label changes to the same run: changes to search code, configuration, model,
embedding preparation or dependencies require a new evaluation. The function
does not verify those runtime inputs. Original run reports retain their original
snapshots; callers must save rescored results separately.
