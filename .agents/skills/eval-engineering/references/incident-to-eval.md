# Seeding evals from incidents

The highest-signal evals are regressions from real failures, and MoltNet's signed
episodic diary is a corpus of them. But treat this as a **seed → author** pipeline,
not extraction, and apply two filters first.

## Filter 1 — is it agent-behavioral?

An eval here tests **what an agent does**. Only incidents whose root cause is agent
behavior qualify:

- ✅ Agent-behavioral (evalable): forgot to regenerate the Go client after a schema
  change; fabricated a verification pass; uploaded a file containing a secret;
  skipped the diary search and repeated a known mistake; invented a JSON shape
  instead of using the submit contract; put an early return inside a middleware
  that skipped auth.
- ❌ Not agent-behavioral (not evalable _here_): stale lockfile, CI externalization,
  a bundler pulling Node code into a browser build, a flaky test. These are
  engineering failures — fix them with tests/CI, not agent evals.

Expect a **minority** of incidents to pass this filter. That's fine.

## Filter 2 — is the failure class recurring or high-severity?

One-offs don't earn a permanent eval (corpus bloat, slow CI, brittle scenarios).
A class does — "agents skip step N of the codegen chain" or "agents leak secrets
into artifacts". Dedup: multiple incidents of one class → one scenario.

## Authoring — strip the fix out

The diary entry contains what-happened / root-cause / fix / watch-for. The scenario
must contain **only the setup that reproduces the failure** — never the fix:

1. Take the _situation_ from the entry, not the resolution.
2. Write `task.md`/`prompt.md` as a plain request that leads toward the wrong
   answer; do not name the gotcha (that's the `watch-for` from the entry — it stays
   out).
3. Put the root cause and failure mode in the judge-only rationale
   (`criteria.json.context` / rubric `preamble`) — never in the target-visible text,
   and never as an exact value the criteria then look up.
4. Promote every mechanical consequence to a **gate** (e.g. "a `go generate` /
   `generate:openapi` step ran", "no artifact matched a secret regex"); reserve the
   judge for whether the target _articulates_ the failure mode.

## Leakage guard (critical for this repo)

`standard-engineering` context _instructs the agent to search the diary proactively_.
If the scenario is seeded from incident entry X and the target can reach the diary,
it can retrieve X — which contains the fix — and game the eval. So:

- Run incident-derived evals against an **isolated or scrubbed diary** (no entry X,
  no sibling entries that name the fix), or
- Ensure the eval's runtime has no diary access for that run.

Confirm this before trusting any incident-derived baseline.

## Worked example

`evals/moltnet-practices/codegen-chain-go-client/` is the model: seeded from the
recurring "agent edits a TypeBox schema, regenerates the OpenAPI spec, but forgets
`go:generate`; the Go build stays green with a stale client and it only fails at
runtime" class. The `task.md` just asks to add a schema field and "regenerate any
artifacts" — it never says "don't forget the Go client". 30 of 100 points ride on
actually regenerating the Go client; 25 on _explaining_ the schema → OpenAPI → Go
dependency chain and what breaks if you skip it. Correct edits without the
articulation cap well below pass. Study it before authoring a new incident eval.
