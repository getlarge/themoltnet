# simple-eval-runner

Meetup demo: a programmatic eval runner in ~350 lines of TypeScript, using
the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
to drive Claude and the [MoltNet SDK + CLI](https://themolt.net) to fetch a
team knowledge pack.

The headline result: run a handful of eval scenarios twice — **cold** (agent
sees only the task) and **warm** (agent also sees a pre-rendered MoltNet pack
with team knowledge). Judge both with the same weighted checklist. The delta
between cold% and warm% is the value MoltNet adds.

## The loop

1. Load scenarios from `../../evals/moltnet-practices/` (task.md + criteria.json).
2. Fetch the rendered pack (one network call — pack UUID from `.env`).
3. For each scenario, in parallel:
   - Cold run — Agent SDK `query()` with `cwd` pointed at an empty sandbox dir.
   - Warm run — same, plus the pack injected into the system prompt.
4. LLM judge (`@anthropic-ai/sdk` + Zod) scores each workspace against
   `criteria.json`, mirroring the Go DSPy checklist judge.
5. Print a cold/warm/Δ table.

No auto-incident writes, no multi-agent orchestration. Single agent, external
memory via a pre-compiled pack.

## Why it's a standalone subdir

Not part of the pnpm workspace — has its own `package.json`, uses published
`@themoltnet/sdk` from npm. Clone, `npm install`, run.

## Run it

```bash
cp env.example .env
# Fill in ANTHROPIC_API_KEY and check MOLTNET_CREDENTIALS path
npm install
npm start
```

Results land in `results/<scenario>/{cold,warm}/` (agent outputs) and
`results/<scenario>/{cold,warm}.json` (run metadata + judge scores).

## Default scenarios

All three are covered by the current pinned pack
(`6e1e24d4-4a80-41bd-8a04-736c0c902794`, "MoltNet Database, CLI & Auth
Patterns"):

| Scenario                         | What it tests                                     |
| -------------------------------- | ------------------------------------------------- |
| `auth-middleware-early-return`   | Session-path skips `resolveTeamContext` (PR #667) |
| `repository-tenant-scope-bypass` | `ids` branch skips `diaryId` tenant filter        |
| `e2e-raw-fetch-vs-api-client`    | Use `@moltnet/api-client` helpers, not raw fetch  |

Override with `SCENARIOS=scenario-a,scenario-b`.

## Model choice

Defaults to `claude-opus-4-7` for both agent and judge. To match the Go CLI's
claude agent default, set `AGENT_MODEL=claude-sonnet-4-6`. Lowering the agent
model sharpens the cold/warm delta.

## Files

- `src/index.ts` — orchestration, table printing
- `src/scenarios.ts` — load `task.md` + `criteria.json`
- `src/pack.ts` — shell out to `moltnet rendered-packs get`
- `src/runAgent.ts` — `query()` with `cwd` sandbox, `settingSources: []`
- `src/judge.ts` — `messages.parse()` + Zod checklist schema
