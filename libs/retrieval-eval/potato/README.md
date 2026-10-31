# Retrieval evaluation with Potato

This directory owns the search-specific annotation workflow. The evaluation
library owns datasets, approvals, queries, judgments and scoring; Potato owns
review forms and saved annotations. Shared account/MCP operations and runtime
installation live in [tools/potato](../../../tools/potato/README.md).

| Path                   | Responsibility                                                 |
| ---------------------- | -------------------------------------------------------------- |
| `tasks/corpus/`        | Corpus approval form, chat instructions and decision rubric    |
| `tasks/queries/`       | Query exploration form and decision rubric                     |
| `tasks/relevance/`     | Answers/Supports/Not relevant form and decision rubric         |
| `scripts/`             | Convert frozen retrieval evidence into task inputs and layouts |
| `../__tests__/potato/` | Python adapter and layout regression tests                     |

Run Python checks with the shared environment selected by `POTATO_PYTHON`:

```bash
pnpm exec nx run @moltnet/retrieval-eval:test:potato
```

Keep each task's generated data, layouts, predictions and exports in its private
workspace. Moving these source files does not migrate or restart hosted tasks.
New setup commands below use the new paths; existing private task copies remain
valid. Do not use this workflow's schema names or grades for unrelated tasks.

## Reviewer walkthrough

The workflow has three different units of work. Keep their decisions separate:

1. **Corpus review:** read one sanitized diary entry. Approve unchanged text,
   propose an edit, or exclude it. Add topic tags and notes that will help draft
   queries later. A proposed edit needs another scan and human approval before
   it becomes dataset content.
2. **Query drafting:** use the approved corpus to describe a realistic question
   and its **information need**: what the searcher is trying to learn and what
   would satisfy them. The information need is authored context, not a model
   score or a field automatically recovered from the query. Explore candidate
   queries before admitting them to the benchmark; keep related query families
   in the same development or held-out split.
3. **Relevance review:** judge one query/entry pair at a time. The candidate
   entry is one result for that query, drawn from the deduplicated top-ten union
   across configurations. Several items therefore share a query. Choose
   Answers (2), Supports (1), or Not relevant (0), and give a reason. Leaving it
   unanswered means Not reviewed, never Not relevant. Full-corpus review can
   add answers the retrieval configurations missed.

Use the ordinary annotation page for human decisions. Chat can explain an entry
or suggest wording and topics; review its claims against the displayed text.
With the advisory layout, the model choice appears separately and unanswered
controls remain unselected. Click a label to accept or override the suggestion.
Potato autosaves changes; both Next and Previous save the form before navigation.
An untouched suggestion is not a form answer. After submitting, verify progress, navigate to another item, and return to check
the saved answer. A refresh can restore unsaved browser form state; session
continuity alone does not prove annotations survived a server restart.

### Understanding the labeling-engine dashboard

`/admin/labeling-engine` describes machine predictions and the evidence for
accepting them. It does not grade the dataset or certify that entries are safe
for publication.

| Display                  | How to read it                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Predictions / calls      | Work performed by the model, not completed human reviews.                                                          |
| Accepted / resolved      | Engine acceptance state; never a substitute for corpus release approval.                                           |
| Error 5%, confidence 95% | A configured statistical target. Until its validation requirements are met, it is not a measured accuracy claim.   |
| Human requests 0         | In our exploratory overlay the engine's human-request budget is zero. The ordinary review queue remains available. |
| Model probability        | Uncalibrated model confidence, not the probability that a human will agree.                                        |
| Cost $0                  | May mean the model has no price in Potato's accounting table. Check provider billing before treating it as free.   |

For the first corpus, use the dashboard to inspect predictions and provenance;
review all entries yourself. The current overlay does not establish an
acceptance guarantee. Changing the model or rubric requires new validation.

### What happens after annotation

Potato stores the annotation project; the retrieval library owns the benchmark
snapshot and scores. Save an export along with its task inputs and manifest.
The [relevance import commands](../README.md#potato-judgment-roundtrip)
map an explicitly selected human reviewer's judgments back to frozen query and
entry IDs, reject stale hashes, and rescore saved rankings without rerunning
search. Model predictions and Solo synthetic cases are not ordinary human labels.

Corpus approvals, exclusions and edit proposals use the separate
[corpus import](../README.md#potato-corpus-decision-roundtrip).
Preview the selected reviewer's export before applying it. Approvals bind to
exact displayed content; edits remain pending drafts. Submission in Potato does
not itself freeze a dataset. Publication is a later, explicit action.

## Operator environment

Create an isolated Python environment and install `tools/potato/requirements.txt`. The MCP
SDK must remain below v2 while Potato imports `mcp.server.fastmcp`.
Use that environment's Python for the commands below. Deployment state and
credentials belong in the private task directory, outside the checkout.

### Local tasks and hosted tasks

A persistent hosted task is useful for remote reviewers and collaboration. A
local task is useful for preparing a new study or piloting its instructions.
Both use the same config and JSONL inputs; neither requires a custom frontend.
Potato documents one task per server instance, with different ports for separate
tasks ([usage guide](https://potatoannotator.readthedocs.io/en/latest/deployment/usage/)).

For a local exploration pilot, first prepare sanitized `explore.jsonl` using the
[ranking export workflow](#put-exploratory-rankings-into-potato-through-mcp). Then,
from the repository root:

```bash
export POTATO_LOCAL_TASK="$HOME/.local/share/moltnet/retrieval-eval/local-explore"
mkdir -p "$POTATO_LOCAL_TASK"
chmod 700 "$POTATO_LOCAL_TASK"
python3 -m venv "$POTATO_LOCAL_TASK/.venv"
"$POTATO_LOCAL_TASK/.venv/bin/pip" install -r tools/potato/requirements.txt
cp libs/retrieval-eval/potato/tasks/queries/config.yaml "$POTATO_LOCAL_TASK/config.yaml"
"$POTATO_LOCAL_TASK/.venv/bin/python" libs/retrieval-eval/potato/scripts/prepare_ranked_layout.py \
  --config "$POTATO_LOCAL_TASK/config.yaml" --run /private/completed-run.json
# Copy your sanitized explore.jsonl to "$POTATO_LOCAL_TASK/items.jsonl".
```

In that private config, set `user_config.allow_all_users: true` to let yourself
register locally. Keep `host: 127.0.0.1`, `require_password: true` and the persistent
`authentication.user_config_path`. Do not expose this local registration setup
through a public tunnel. Hosted tasks retain a closed roster. The template has
no enabled cloud assistance or MCP access; add those explicitly when wanted.

```bash
cd "$POTATO_LOCAL_TASK"
.venv/bin/potato validate config.yaml --strict
.venv/bin/potato start config.yaml -p 4331
```

Open `http://127.0.0.1:4331/`. Stop with Ctrl-C and restart from the same directory
to resume. For relevance review, use `tasks/relevance/config.yaml`, the sanitized
`relevance.jsonl` as `items.jsonl`, a separate private directory and port 4332.
Never run two processes against the same task directory. A local copy and the
hosted task do not synchronize automatically; keep their exports and reviewer
identities explicit when importing judgments.

### Task design and pilot checks

The inputs are text: one query plus four ranked lists for exploration, and one
query–entry pair for relevance. The current workflow has one human reviewer;
machine proposals are separately attributed. No training or attention-check
phase has been imposed. Related query families remain together when splitting
the eventual benchmark.

Exploration uses Potato's `task_layout` extension for collapsible ordered lists:
each result has its rank, bold title and separate preview. The small
`prepare_ranked_layout.py` helper generates the annotation controls through
Potato's own schema generators; it does not reimplement saving or navigation.
Run it again after changing the annotation schemas. It renders existing ranking
strings with explicit HTML escaping, without rewriting item data or judgments.
Previews are truncated; **Read full entry** expands the complete approved text
from the frozen run. Run ID, query text and exact ranking previews must match
before full text is shown. The generated layout contains private corpus text:
keep it with the private task, never commit it or serve it as a public asset.
The expansion adds reading context, not a relevance label.
Expand lists before judging; collapse them to compare another configuration.
Poor retrieval can reveal a valuable test case:
do not drop a useful query merely because current results are bad.

Relevance keeps the full entry visible. For a query asking why a build failed:
an entry naming the cause directly **Answers**; useful diagnostic context without
the cause **Supports**; a different build incident with no useful connection is
**Not relevant**. Shared vocabulary alone is insufficient. Leave uncertain work
unsubmitted for later review rather than treating missing review as grade zero.
Radio labels preserve the agreed grades through the importer, but Potato's radio
agreement is categorical; it is not a graded ranking metric.

Before a new task goes live, validate it, inspect startup logs, and walk a small
disposable pilot through save, next, back and process restart. Inspect persisted
answers: browser refresh alone can restore unsaved form state and give a false
impression of durability. Use the Potato skill's UI and persistence checks on
that disposable copy, not generic test submissions in the real reviewer's queue.
After review starts, preserve schema names and labels. This refinement changes
instruction prose and display options only, not stored items or judgments.

Open decisions for the larger study: how many additional human reviewers to
invite, and how much overlapping review to budget before reporting agreement.
The skill's effort estimator, run on this batch at 220 words/minute, projects
about 77 minutes for 10 exploratory queries and 172 minutes for 123 relevance
pairs. It assumes reading every item, 25 seconds per free-text answer and no
breaks. Repeated entries and optional rewrites may reduce this; measure actual
pilot pace before scaling rather than treating these estimates as a quota.

## Dataset publication and retrieval evaluation

The admin publishing wizard can create a local archive and dataset card, or
upload to Hugging Face/Zenodo. Start with a local archive for review. A Potato
snapshot identifies the annotation project; it does not replace the retrieval
evaluation dataset contract.

For search, preserve stable query/entry IDs, content hashes, label revisions,
reasons and query-family splits when importing judgments. Map Answers to 2,
Supports to 1, and Not relevant to 0; missing judgments remain absent. Avoid
automatic per-item train/test splits because related queries must stay together.
Keep raw human judgments and model suggestions distinct; an automatically
aggregated `gold` split is not automatically an adjudicated search benchmark.

Publishing source items can disclose their full text. Annotator anonymization
does not sanitize diary contents. Retain the Secretlint, local screening and
human-approval steps before exporting a releasable corpus. Publication remains
an explicit action, separate from preparing or previewing an archive.

## Corpus before queries

`tasks/corpus/config.yaml` is the first annotation stage: review sanitized diary
copies, approve unchanged text, propose edits, or exclude entries. Copy the
config into a private task directory and supply its closed reviewer roster.
The displayed fields are `title`, `content` and `captured_age`, with `id`
identifying the item. Precomputed screening stays in private records and is no
longer shown on the corpus-review page. The text-edit widget records a proposal, not an alteration
to the frozen source. An edited copy requires scanning and fresh approval.

Capture through the released CLI into a new private workspace:

```bash
export NX_LOAD_DOT_ENV_FILES=false
pnpm exec nx run @moltnet/retrieval-eval:capture -- \
  --diary DIARY_UUID --workspace /private/new-capture \
  --seed corpus-capture-v1 --size 300
```

The recovered recipe balances entry type, first alphabetical scope tag and
calendar quarter, using seeded ordering and round-robin selection. This favors
coverage, not population-weighted estimates. The command rejects changing totals
and duplicate IDs, but the API does not provide a transactional snapshot. A
failed enumeration writes no sample; retry while the diary is stable. Null tags
are normalized, Secretlint runs before copies are persisted, and source-ID
mappings stay private. Each successful capture receives a new version; it is not
the missing historical snapshot.

Run local screening before preparing hosted batches. Keep flagged or failed
items local for further review. Record that selection rule: reviewing only
unflagged items cannot establish overall screening accuracy or population prevalence.
No automatic screen constitutes approval. After corpus decisions are imported
and an approved snapshot is frozen, use its content to draft information needs;
repository-context query proposals are not evidence of corpus answerability.

### Compact corpus review form

Generate the layout after configuring the private corpus task:

```bash
python libs/retrieval-eval/potato/scripts/prepare_corpus_layout.py \
  --config /private/corpus/config.yaml \
  --output /private/corpus/corpus-task-layout.html
```

Set `task_layout: corpus-task-layout.html` and restart the task. Previous and
Next stay at the bottom of the viewport, using Potato's original validation and
save handlers. The optional body editor is collapsed under “View or propose a
body edit”; open it to inspect an existing proposal or edit the copy. Its text
area resizes vertically. The original entry remains above the form, so the
editor's duplicate original-text panel is hidden. The separate review-notes box
is for exclusion reasons or context, not a second replacement body.

The generated layout preserves schema names and edit JSON storage. Regenerate
it if annotation descriptions or schemes change. Nothing is submitted by
opening the editor or navigating to an unreviewed item.

### Expand the corpus before scaling relevance review

The first exploration round used only 27 approved entries from the new
300-entry capture. The reviewer found sensible questions but few useful results
per question. Treat that as a corpus-coverage limitation to investigate, rather
than assuming the queries are wrong or asking the reviewer to finish a sparse
relevance queue.

Finish screening the captured entries and add eligible copies to the existing
corpus task. Keep reviewed IDs and their exact text unchanged, preserve the
existing annotation schemas, and set `max_annotations_per_user: -1` so the
completed reviewer can receive newly added items. Snapshot the task before
extension; never reset user state to make the new queue appear. Check both the
item count and the returning reviewer's remaining assignments after restart.
A returning reviewer may have a saved per-user quota and a `done` phase; the
global setting does not overwrite those. Raise the quota through the native
admin assignment API. For this internal task with no qualification or paid
crowd phases, enable `allow_phase_back_navigation` and use native Previous-phase
navigation to return to annotation. Do not hand-edit the saved state or reset
answers. Verify the reopening survives a restart.
Existing approvals remain valid for their original copies; new items start
unreviewed. Refresh model advice from recorded calls for the full
expanded input file, preserving input hashes and provenance.

Save the completed Explore export before preparing another query version. Apply
its keep/revise/drop decisions, and include real usage examples such as “how
should docs be written?” and “docs voice” with explicit information needs.
These examples are proposals until searched against the expanded approved
corpus. Do not select only queries with good results: retain representative
specific lookups, broader guidance questions and short topic searches.

Human approval is still the gate: import new corpus decisions and freeze a new
approved dataset before rerunning retrieval. Build the next relevance queue
from that run's deduplicated top-ten union. Keep previous runs, judgments and
query versions attached to their original snapshots; a new corpus must not
silently replace the inputs of an old experiment. No need to finish the earlier
sparse relevance pilot just to unlock this step.

### Approved-corpus exploration round 2

The second round searches a frozen snapshot of **276 human-approved copies**.
The disposable database contains only those copies: excluded entries, pending
edits and the live diary are outside the search universe. Relative entry ages
remain anchored to capture time under the dataset's recorded time policy.

The completed first Explore export contributed nine kept queries. One query
marked Revise had no replacement wording and remains deferred. Two user-proposed
documentation queries bring the new round to eleven queries across seven
families. These are development queries; no relevance judgments were inferred
from query approval or earlier model suggestions.

Four configurations, top ten and two repeats produced 88 searches. All 44 repeat
pairs returned identical ranked IDs. Their deduplicated top-ten union contains
128 query/entry pairs. Repeatability verifies the run protocol, not retrieval
quality; precision remains incomplete until the returned entries are judged.
Corpus-wide recall and verified no-match claims still require full-corpus
judgments.

Use the separate `/explore-v2/annotate` task to inspect the larger corpus's
rankings and `/relevance-v2/annotate` to judge candidates. The original tasks,
exports and runs remain attached to their original snapshots. Each task has its
own login session, progress and `/admin/labeling-engine` dashboard. Model
suggestions are advisory and editable; they do not count as human completion.
The full-entry expanders are generated from this round's frozen run.

### Deferred classifier follow-up

Continue query exploration before tuning the corpus classifier. Track these
steps for a separate change:

- Version an explicit decision rubric and verify the exact model input, including
  the intended title and provenance fields. Human-facing instructions alone do
  not establish which instructions a model received.
- Test whether keywords, UUIDs or hashes change decisions using paired examples
  that preserve meaning. This is a hypothesis to test, not an established cause.
- Compare disagreements by content category and error direction on the whole
  development sample, including PR-review entries. Avoid reporting agreement
  from assisted human review as independent model accuracy.
- Reserve a fresh, blind held-out sample before evaluating a revised rubric.
  Treat labeling-engine contracts as validation requirements, not automatic
  acceptance guarantees; choose any acceptance budget explicitly.

Detailed review findings stay in the signed diary and private exports. Prompt
experiments must preserve those original records and must not rewrite approvals
or relevance judgments.

### Optional model assistance for corpus review

Merge `tasks/corpus/chat.yaml` into the private task configuration to enable the
conversational sidebar. It uses Gemma through Ollama Cloud and the server-side
`OLLAMA_API_KEY`. Authorize the provider to receive the displayed sanitized copy
and chat messages before enabling it. Chat helps interpret or propose edits; it
does not approve entries. Earlier local Nimble scores are precomputed artifacts
from the capture machine, not live calls from the hosted task to that machine.

`tasks/corpus/decisions.yaml` enables Potato's native labeling engine with Clef via
`systemone`. It intentionally leaves the ordinary human assignment strategy in
place. Its unvalidated acceptance contract and zero human-request budget keep
this an exploratory prediction pass, not automatic dataset approval. Inspect
predictions and call provenance in `/admin/labeling-engine`. The running server
starts the planner automatically. For an offline batch, stop the server first
(the engine refuses concurrent writers), then run:

```bash
python -m potato label run config.yaml --max-items 28 --max-ticks 1 --json
python -m potato label status config.yaml --json
```

Decision backends do not work under `ai_support` or `chat_support`: they choose
labels, whereas those assistants generate text. Do not turn engine labels into
human corpus approvals or import the engine export as ordinary human judgments.
The engine's confidence is model probability, not validated correctness.

For assisted review, keep `pre_annotation.enabled: false`. Native preselection
is unsafe for explicit human review: Potato saves selected controls on Previous
as well as Next, so merely navigating can accept a model choice. Existing
answers cannot reliably be classified as intentional from their labels alone;
preserve them and ask the reviewer to recheck questionable items.

Generate a separate advisory panel after preparing the verified sidecar:

```bash
python libs/retrieval-eval/potato/scripts/prepare_advisory_layout.py \
  --config /private/task/config.yaml --items /private/task/all-items.jsonl \
  --predictions /private/task/query-suggestions.json \
  --provenance /private/task/query-suggestions.json.provenance.json \
  --layout /private/task/ranked-task-layout.html \
  --output /private/task/advisory-task-layout.html
```

Omit `--layout` for a task without a custom layout. Set `task_layout` to the new
file and restart. Preserve the original layout as the input when regenerating;
do not wrap the advisory layout in itself. The helper validates input hashes,
escapes advice and never selects a control. Previously saved human answers
continue to render normally. Keep sidecar provenance with exports: these are
assisted judgments, not blind accuracy measurements.

The engine makes the cloud calls inside the task. To connect its recorded
predictions to the ordinary review form, prepare the native sidecar after the
prediction pass and restart the task:

```bash
python libs/retrieval-eval/potato/scripts/corpus_suggestions.py \
  --database /private/task/engine.sqlite --items /private/task/items.jsonl \
  --source-version SOURCE_VERSION_ID --output /private/task/corpus-suggestions.json
```

Use the source version reported by the engine, not an inferred latest model.
The helper verifies each decision's recorded model-call input hash against the
item body and rejects missing, failed, stale or invalid predictions. It writes
mode-0600 native choices plus a provenance sidecar; it never writes human labels.
A redacted model input that differs from the task body is rejected too and needs
explicit preparation, not a bypass of this check. Run against a stopped task
for a stable snapshot; the source engine's SQLite database stays read-only.
If copying it for inspection, include any `engine.sqlite-wal` alongside the
database after stopping the task, or use SQLite's backup API. Stopping alone
does not guarantee all recorded calls have been checkpointed into the main file.

The sidecar is loaded at startup, not refreshed by each page view. For new or
edited inputs, rerun predictions under a fresh source revision, regenerate the
sidecar and restart before review; do not reuse an old suggestion file. The
pinned Potato engine skips existing predictions by item/source identity, so
merely editing content under an existing ID is insufficient. Unchanged inputs
reuse recorded calls without paying for another prediction on every visit.

The sidecar format is compatible with Potato 2.13; the advisory layout uses
its supported task-layout interface. Recheck the workflow before upgrading; the engine's
statistically certified verification queue is a different mode and is not
required for this fully human-reviewed corpus.

### Decision suggestions for queries and relevance

Merge `tasks/queries/decisions.yaml` into the query exploration configuration, or
`tasks/relevance/decisions.yaml` into relevance review. Both use Clef through Ollama
Cloud with the same server-side key as corpus review. Query suggestions are
Keep exploring / Revise / Drop; relevance suggestions are Answers / Supports /
Not relevant. Rewrites, notes and required relevance reasons remain human input.

These overlays deliberately have **no acceptance contracts** and a zero engine
human-request budget. Potato still predicts, but cannot automatically accept
machine labels. Continue using the ordinary review queue. The engine dashboard
shows prediction coverage and recorded calls, not certified accuracy:

- [Query engine](https://potato.themolt.net/explore/admin/labeling-engine)
- [Relevance engine](https://potato.themolt.net/relevance/admin/labeling-engine)

For initial setup, enable only the overlay's `labeling_engine` block. Wait for
successful predictions, stop the task, prepare its sidecar, then generate the
advisory layout above and restart with native preselection disabled. Use the **complete** private input JSONL;
MCP-added instances can live in the runtime journal rather than the bootstrap
`data_files`. A headless batch reading only that bootstrap misses those instances.

```bash
python libs/retrieval-eval/potato/scripts/corpus_suggestions.py \
  --schema decision --database /private/explore/engine.sqlite \
  --items /private/explore/all-items.jsonl --source-version SOURCE_VERSION_ID \
  --output /private/explore/query-suggestions.json
python libs/retrieval-eval/potato/scripts/corpus_suggestions.py \
  --schema relevance --database /private/relevance/engine.sqlite \
  --items /private/relevance/all-items.jsonl --source-version SOURCE_VERSION_ID \
  --output /private/relevance/relevance-suggestions.json
```

The shared helper checks the exact `context` sent to the model, including query
and information need, rather than just the entry body. Query decisions see the
recorded ranked snippets; relevance decisions see the full candidate content.
Expand entries yourself when judging queries: poor retrieval does not prove a
query is invalid. Saved human answers remain selected; model advice is displayed
separately. Retain suggestion provenance and treat resulting judgments as assisted review,
not an independent blind test of Clef. New or changed inputs require regenerated
predictions and sidecars as described above.

## Put exploratory rankings into Potato through MCP

Use `tasks/queries/config.yaml` for one page per query with the four saved top-ten
rankings and a Keep exploring / Revise / Drop decision. Use
`tasks/relevance/config.yaml` for one page per deduplicated query–entry pair with the
Answers / Supports / Not relevant rubric and a required reason. These are
separate tasks: revising a query does not silently relabel its old results.
Keep the earlier corpus-review task and all annotations intact.

After copying the exploration config into its private task directory, generate
the referenced layout before validating or starting that task:

```bash
python libs/retrieval-eval/potato/scripts/prepare_ranked_layout.py \
  --config /private/explore/config.yaml --run /private/completed-run.json
```

First prepare a relevance manifest with the retrieval library's `potato` target
from the exploratory dataset and completed run. Then render both task batches:

```bash
python libs/retrieval-eval/potato/scripts/prepare_review_tasks.py \
  --run /private/run.json --manifest /private/relevance-manifest.json \
  --proposals /private/query-proposals.json --output /private/review-batch-v1
```

The proposals file contains `queries` with `id`, `text`, `textHash` and
`informationNeed`. Proposed seed judgments are deliberately not shown or
preselected. The renderer requires the manifest's dataset hash to match the run,
unchanged query/entry text and hashes, and a top-ten ranking from each of the
four configurations. Keep the resulting JSONL private and Secretlint-scan it
before upload. Its excerpts are for query exploration; the relevance task shows
the full entry. Relevance IDs remain exactly those in the immutable manifest.

Configure the closed reviewer roster before starting either task. Bootstrap
with the first genuine item in `items.jsonl`, and set
`max_annotations_per_user: -1` so runtime additions can be assigned. For the
curator agent, explicitly allow only these MCP tools:

```yaml
mcp:
  enabled: true
  tools:
    [get_status, get_progress, list_items, get_item, add_items, export_data]
  destructive: []
  audit_log: mcp_audit.jsonl
```

Issue a separate token for each task and store it outside the local authoring
root. Potato requires its admin role for this combination of tools; the explicit
allowlist excludes annotation submission, deletion and publication. Adding a
tool later expands existing tokens' access, so review allowlist changes.

```bash
python tools/potato/scripts/mcp_load_items.py \
  --url https://annotation.example.org/explore \
  --token-file /private/explore.token --root /private/mcp-authoring \
  --items /private/review-batch-v1/explore.jsonl
```

Repeat for the relevance task with `relevance.jsonl`. This is an actual stdio MCP
client calling Potato's live tools. It inventories IDs, checks existing content
before mutating anything, adds only missing items in batches, and reads back
status and progress. A retry of the same immutable batch is safe. If an existing
ID differs, it refuses to overwrite reviewed inputs; make a new version/task.
The server journals MCP-added items for restart recovery. Back up that runtime
journal with the task directory, not just the original seed `items.jsonl`.

Potato's live MCP surface does not provide item deletion. Retire a query by
recording Drop, then omit it from the next frozen task version; keep the old task
for its annotations and provenance. Do not substitute `delete_annotations` for
item removal. Export ordinary human annotations through `live_export_data` and
import against the matching manifest. Exports are written on the server; obtain
them through the private operational channel rather than making a public URL.

### Scoped MCP writes for an agent reviewer

For interactive agent work, also allow `submit_annotation` and `assign_items`,
but scope their `username` argument to a declared machine reviewer:

```yaml
mcp:
  enabled: true
  tools:
    [
      get_status,
      get_progress,
      list_items,
      get_item,
      list_annotators,
      get_agreement,
      add_items,
      assign_items,
      submit_annotation,
      export_data,
    ]
  scope:
    users: [agent-reviewer]
  destructive: []
  audit_log: mcp_audit.jsonl
machine_annotators:
  enabled: true
  annotators:
    - id: agent-reviewer
      kind: llm
      tool: codex
      version: retrieval-exploration-v1
      description: Agent proposals; never human ground truth
```

Provision that reviewer in the annotation phase before using the write tools.
Do not scope writes to a human's username: an agent must not silently submit
judgments as that person. Machine-origin rows remain separate in Potato exports
and are rejected by the library's human-judgment import. Use scalar choices such
as `{"relevance":"Supports","reason":"..."}` so Potato validates label names.
The item-add loader continues to reject overwriting an existing item's content.
Annotation deletion and publication are not enabled by this configuration.

## Pilot journey and lessons

The pilot began with a custom review UI and a reproducible repository-search
runner. We moved annotation to Potato so corpus curation, relevance review and
future agent-trace review can share an established tool. The custom UI was
removed from the existing change; the library still owns contracts, provenance,
workspace revisions, search execution and metrics.

- **Persistence must be exercised, not inferred.** Early Solo edge-case review
  exposed missing persistence. The [shared Solo patch](../../../tools/potato/patches/README.md) saves generated cases, labels
  and notes, with a process-restart regression. An empty generation response
  must not masquerade as completed review.
- **Start with the corpus.** Repository-informed query proposals were useful
  exploration, but did not prove that the sampled entries could answer them.
  Approve the corpus first, then draft and experiment with grounded queries.
- **A recovered recipe is not a recovered snapshot.** The original 300-entry
  sample was unavailable. A new capture uses the documented sampling recipe
  and a new version; it cannot reproduce the missing sample by assertion.
- **Keep model roles visible.** Local Nimble results were computed on the
  capture machine before upload. Hosted Clef decisions use Ollama Cloud;
  hosted Gemma chat also uses Ollama Cloud. Neither means the VM calls back
  into a laptop model. Synthetic decision examples and useful generated edge
  cases established that the workflow was promising, not benchmark accuracy.
- **Preserve the experiment.** Keep Solo prompt history, generated cases,
  human corrections, model identity and exports with the private task. Prompt
  iteration is evidence of development and must not leak into held-out testing.
- **Inspect the actual experience.** The hosted corpus pilot produced 28 cloud
  predictions with no accepted labels, and chat returned an entry-grounded
  response. That verifies the integration, not label quality. The corpus import now has a tested preview/apply path. Human corpus review,
  grounded query selection and final evaluation remain separate gates. The
  expanded corpus has since completed human review; see the next-round record
  below for the approved-only retrieval experiment.

The signed diary records the detailed rationale and incidents; accountable
commits carry `MoltNet-Diary` trailers. This README is the reusable user guide.
Private source mappings, diary copies, credentials and deployment state stay
outside the repository. Agent-trace evaluation is a future use of the same
annotation tooling, not a completed benchmark or an extension of search labels.
