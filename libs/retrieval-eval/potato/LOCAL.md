# Try your own queries locally

Run the production retrieval code against the checked-in approved corpus, compare
rankings in Potato, then add human relevance judgments. This workflow needs no
production credentials or hosted Potato account. The generated tasks use
password-free registration on `127.0.0.1`, with no AI, cloud assistance or MCP.

## Prepare a query experiment

Use Bash or Zsh from the repository root with dependencies installed and Docker
running. Download the embedding model once; retrieval then uses the local cache.
Choose a fresh round directory outside the checkout:

```bash
export NX_LOAD_DOT_ENV_FILES=false
export REVIEW_REPO="$PWD"
export REVIEW_ROUND="$HOME/.local/share/moltnet/retrieval-eval/my-round-v1"
export RETRIEVAL_MODEL_CACHE="$REVIEW_REPO/apps/rest-api/models"
mkdir -p "$REVIEW_ROUND"
pnpm exec nx run @moltnet/rest-api:download-model
cp libs/retrieval-eval/datasets/approved-diary-v1/queries.example.json \
  "$REVIEW_ROUND/queries.json"
```

Edit `queries.json` in your editor. Each array item has `id`, `text`, `family`,
`split` and `informationNeed`. Add or remove items to add or drop queries; keep
IDs unique and related query families in one split. Use `development` while
exploring (`test` is reserved for held-out evaluation). The information need
explains what would satisfy the query; it is not a relevance label.

```bash
pnpm exec nx run @moltnet/retrieval-eval:queries -- \
  --dataset=libs/retrieval-eval/datasets/approved-diary-v1/dataset.json \
  --queries="$REVIEW_ROUND/queries.json" --dataset-version=my-queries-v1 \
  --output="$REVIEW_ROUND/experiment"
pnpm exec nx run @moltnet/retrieval-eval:eval -- \
  --dataset="$REVIEW_ROUND/experiment/dataset.json" \
  --workspace="$REVIEW_ROUND" --top-k=10 --repeats=2
```

The first command creates `dataset.json` and `proposals.json`, computes query
hashes and starts with no judgments at label revision zero. It preserves the
source corpus and refuses an existing output directory. The second command runs
retrieval in disposable PostgreSQL/pgvector and prints a run UUID and status.
Continue only after a completed run. Copy that exact UUID into the next command;
do not select a run by which directory happens to be newest.

```bash
export REVIEW_RUN_ID='REPLACE_WITH_PRINTED_RUN_UUID'
export REVIEW_RUN="$REVIEW_ROUND/runs/$REVIEW_RUN_ID/run.json"
pnpm exec nx run @moltnet/retrieval-eval:potato -- \
  --dataset="$REVIEW_ROUND/experiment/dataset.json" --run="$REVIEW_RUN" \
  --output="$REVIEW_ROUND/manifest.json"
python3 -m venv "$REVIEW_ROUND/.venv"
export POTATO_PYTHON="$REVIEW_ROUND/.venv/bin/python"
"$POTATO_PYTHON" -m pip install -r tools/potato/requirements.txt
"$POTATO_PYTHON" libs/retrieval-eval/potato/scripts/local_review.py \
  --run="$REVIEW_RUN" --manifest="$REVIEW_ROUND/manifest.json" \
  --proposals="$REVIEW_ROUND/experiment/proposals.json" \
  --output="$REVIEW_ROUND/tasks"
pnpm exec secretlint --secretlintrc "$REVIEW_REPO/.secretlintrc.json" \
  "$REVIEW_ROUND/tasks/**/*"
```

Resolve any scan findings before starting. The task generator requires a fresh
output directory and creates `explore/` and `relevance/`, plus frozen evidence. Each task gets a private session key so browser sessions
survive restarts. Keep generated configurations and user state outside Git.

## Review in Potato

Start each task from its own directory. Run the following in separate terminals,
setting `REVIEW_ROUND` there to the same absolute path used above:

```bash
cd "$REVIEW_ROUND/tasks/explore"
"$REVIEW_ROUND/.venv/bin/potato" start config.yaml -p 4331
```

```bash
cd "$REVIEW_ROUND/tasks/relevance"
"$REVIEW_ROUND/.venv/bin/potato" start config.yaml -p 4332
```

Open <http://127.0.0.1:4331/> to compare rankings and record Keep exploring,
Revise or Drop. Open <http://127.0.0.1:4332/> to review candidates grouped by query.
Register with your own human reviewer name and retain that exact name for import.
Leave uncertain candidates unanswered; missing judgments are not negatives.
Provide a reason for every relevance rating. Save, navigate away and return to
check your answers. These local tasks are not intended for public exposure.

Query decisions do not edit the dataset automatically. To revise, add or drop a
query, edit the draft and repeat preparation and retrieval with a new version and
new output directories. Preserve the previous task and its `user_state`; never
replace inputs in a task that has saved reviews.

## Export and rescore

Stop both servers with Ctrl-C before export. From the original repository-root
terminal, export each task from its own directory so relative paths resolve:

```bash
(
  cd "$REVIEW_ROUND/tasks/explore"
  "$POTATO_PYTHON" -m potato.export --config config.yaml --format jsonl \
    --output "$REVIEW_ROUND/explore-export"
)
(
  cd "$REVIEW_ROUND/tasks/relevance"
  "$POTATO_PYTHON" -m potato.export --config config.yaml --format jsonl \
    --output "$REVIEW_ROUND/relevance-export"
)
export REVIEWER='REPLACE_WITH_YOUR_REGISTERED_NAME'
"$POTATO_PYTHON" libs/retrieval-eval/potato/scripts/grouped_relevance.py flatten \
  --groups="$REVIEW_ROUND/tasks/relevance/items.jsonl" \
  --export="$REVIEW_ROUND/relevance-export/annotations.jsonl" \
  --reviewer="$REVIEWER" --output="$REVIEW_ROUND/pair-annotations.jsonl"
pnpm exec nx run @moltnet/retrieval-eval:potato -- \
  --dataset="$REVIEW_ROUND/experiment/dataset.json" \
  --manifest="$REVIEW_ROUND/manifest.json" \
  --annotations="$REVIEW_ROUND/pair-annotations.jsonl" --reviewer="$REVIEWER" \
  --run="$REVIEW_RUN" --output="$REVIEW_ROUND/review-report.json"
```

Flattening maps grouped ratings back to immutable query/entry pair IDs and
preserves reviewer provenance. Import validates the manifest, adds the selected
human's judgments and rescores the saved rankings in `review-report.json`.
It does not rerun search or update the checked-in dataset. Partial review leaves
some metrics unavailable; see [scoring rules](../README.md#fixture-baseline).
Keep original exports, task state and frozen inputs alongside the report.

Model suggestions are optional and separate from this human-only workflow; see
[review with advice](README.md#review-relevance-by-query).
