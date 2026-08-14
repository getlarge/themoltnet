# @themoltnet/content-radar

Correlate what you actually shipped against what the market actually announced,
and draft an evidence dossier for each piece worth writing.

The problem it solves is not "generate content". It is that the weeks you are
deepest in the work are the weeks you least notice that the work is publishable
— and by the time you surface, you have lost the thread between what you built
and what everyone else was announcing while you built it.

## The correlation contract

One rule decides whether a track exists, and trusted code enforces it rather
than the prompt:

> **Every track must cite at least one work signal and at least one market
> signal.**

A track citing only work signals is a changelog. A track citing only market
signals is somebody else's news. Neither is a piece you are uniquely placed to
write. A plan containing either is rejected whole.

## Task graph

```text
operator watchlist (host-parsed, hashed, staged)
            │
   ┌────────┴─────────┐
   │                  │
work scan          market sweep          ← two fan-outs, run concurrently
(one per repo)     (one per segment)
   │                  │
   └────────┬─────────┘
            │ trusted id stamping → signal ledger artifact
            │ server-gated join on every scan + sweep task
      correlation → track plan
            │ trusted validation (correlation contract, budgets, citations)
      draft fan-out (one per selected track)
            │ trusted validation (citation containment, artifact presence)
   dossier.md + wireframe.md per track
```

### What trusted code owns, and what the model owns

The split is the same one `apps/multi-lens-review` uses: agents propose, trusted
code decides what may be cited.

| Owned by trusted code                                         | Owned by the model               |
| ------------------------------------------------------------- | -------------------------------- |
| The watchlist: which repos, which organisations, how far back | How to search inside a segment   |
| Signal ids (`work:<repo>:NN`, `market:<segment>:NN`)          | What is worth reporting          |
| Which citations are legal in a track or a dossier             | Which correlation is interesting |
| Track and draft budgets, duplicate-plan rejection             | The thesis and the beats         |

The model never supplies an id. A phase citing `work:themoltnet:03` is citing
something this run actually observed, because trusted code issued that id when
it parsed the scan output. `assertExactKeys` rejects an output that tries to
supply one.

The organisation on a market signal must be one the watchlist named. A sweep
that surfaces a genuinely interesting announcement from an unlisted company is
rejected — widening scope is an edit to the watchlist file, not a decision the
model gets to make mid-run.

## Run

```bash
# Read-only. Parses the watchlist, prints the normalized scope and its digest.
# Never connects, stages, or creates a task.
moltnet-content-radar --validate --watchlist watchlist.json

# Durable run.
CONTENT_RADAR_DATABASE_URL=<absurd-postgres-url> \
  moltnet-content-radar \
    --team <team-uuid> \
    --diary <diary-uuid> \
    --watchlist watchlist.json \
    --profile content-radar-correlate \
    --scan-profile content-radar-scan \
    --sweep-profile content-radar-sweep \
    --draft-profile content-radar-draft \
    --max-drafts 2
```

The database URL stays in the environment so it is absent from argv and shell
history. Reusing `--correlation-id` reconnects to the same Absurd task;
completed `ctx.step` calls replay from Postgres after a crash, and their values
are task ids and artifact references, never signal bodies or dossier prose.

Profile names resolve to immutable ids once, before the workflow spawns, so a
profile renamed mid-run cannot silently reroute a phase.

Start from [`watchlist.example.json`](./watchlist.example.json).

## Runtime profiles

Four profiles, in [`profiles/`](./profiles), one per phase. Each carries the
narrowest tool surface its phase needs:

| Profile                   | Network  | Tools                            | Why                                                                                                  |
| ------------------------- | -------- | -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `content-radar-scan`      | none     | diary read tools                 | Must not reach the open web, so a hostile page cannot influence what it reports about your own repos |
| `content-radar-sweep`     | Exa only | `exa_search`, `exa_contents`     | The only phase that reaches outside MoltNet at all                                                   |
| `content-radar-correlate` | none     | none                             | Every id it may cite is already in its brief; it needs judgement, not tools                          |
| `content-radar-draft`     | none     | `read`, `write`, artifact upload | Its sources are the per-track packet; new research here would escape the ledger                      |

Create them with:

```bash
moltnet profile create --from-file profiles/content-radar-sweep.json --team-id <team-uuid>
```

The sweep profile needs the [content-radar runtime](../../examples/content-radar-runtime)
(`runtimeKind: content_radar_pi`) and `EXA_API_KEY` in the daemon process
environment. See
[Running Agents → Runtime Profiles](../../docs/operate/running-agents.md#runtime-profiles).

Adding a voice guide as a `context` entry on the draft profile is the intended
way to shape wireframe beats to your register — it belongs to the profile, not
to any one task.

## What it deliberately does not do

It does not write the finished piece. The draft phase produces an evidence
dossier and a beat-level wireframe, and is explicitly told that a wireframe full
of polished sentences is worse than one full of honest beats, because polished
sentences invite you to accept the model's voice instead of using your own.

## Known limits

These are real, and worth knowing before you run it:

- **Repository scanning is diary-first.** Scan tasks run with
  `execution.workspace: 'none'`, so the scan phase reads the signed diary rather
  than a checkout. Rationale entries are usually the more publishable signal
  anyway, but a repo with no diary yields thin scans. Per-repo worktree
  scanning needs per-repo profile routing (a daemon is bound to one workspace),
  which is the obvious next increment.
- **The Exa tools are host-scope, not VM-scope.** They run in the daemon's
  runtime process, so `sandbox.network.allowedHosts` does not constrain them.
  Their egress is constrained by the tool implementation. See the
  [runtime README](../../examples/content-radar-runtime/README.md).
- **No recovery flags yet.** `apps/multi-lens-review` can re-attach accepted
  phase tasks from an interrupted run via `--planner-task-id` and friends.
  Content radar has no equivalent, so a terminal child-task failure means a
  fresh correlation.
- **`src/strict-json.ts` duplicates the multi-lens helper.** Both apps validate
  agent JSON identically; extracting it into `@themoltnet/tasks-orchestrator` is
  a pending follow-up, not an oversight.

## Testing

```bash
pnpm exec nx run @themoltnet/content-radar:test
```

The workflow tests drive the whole graph against `FakeTasks` and
`inlineContext` — no database, no daemon. They assert the shape of the graph
(the server-gated join, per-phase profile pinning) and that a draft citing a
signal outside its track fails the run.

## License

AGPL-3.0-only
