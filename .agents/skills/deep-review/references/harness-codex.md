# deep-review execution adapter — Codex

Bindings for running deep-review in **Codex CLI**. The core (`SKILL.md`) and briefs describe review **tiers**
and **capabilities**; this file maps them to Codex mechanisms. Load this once, before Phase 1.5.

Codex's subagent model differs from Claude Code's in one way that shapes everything below: **model and
`model_reasoning_effort` are pinned per named agent, not chosen per delegated call.** A parent selects *which
named agent* handles each part of the work (Codex subagents docs show exactly this: "Have `pr_explorer` map…,
`reviewer` find risks…"). So on Codex a **tier is a named agent**, not a per-call model argument. Codex ships
built-in agents (`default`, `worker`, `explorer`) and supports project-scoped custom agents in
`.codex/agents/*.toml` that pin `model` and `model_reasoning_effort`.

Requires `[features] multi_agent = true` in `config.toml` for concurrent subagents. Without it, run the tiers
**sequentially** in the main thread (see Concurrency).

## Argument source

The review target and flags arrive in the invoking prompt — read them from the user's message text.

## Tier → agent

Two ways to bind tiers; pick whichever the project has set up.

**A. Recommended — three project agents** (`.codex/agents/deep-review-{high,standard,fast}.toml`), each pinning
model + effort. Delegate each specialist to the agent matching its tier:

| Tier | Agent | Suggested pin |
|---|---|---|
| `highest` | `deep-review-high` | `model = "gpt-5.6"`, `model_reasoning_effort = "high"` |
| `standard` | `deep-review-standard` | `model = "gpt-5.6"`, `model_reasoning_effort = "medium"` |
| `fast` | `deep-review-fast` | `model = "gpt-5.6-terra"`, `model_reasoning_effort = "low"` |

**B. No setup — built-in agents + effort in the instruction.** If those project agents don't exist, map tiers to
built-in agents and state the intended reasoning effort in the delegation instruction so the agent budgets
accordingly: `highest`/`standard` → `worker` (ask for high / medium effort respectively), `fast` → `worker` at
low effort or `default`. This is weaker than option A (effort isn't pinned) but preserves the tier *ordering*.

The security-critical upgrade in `specialists.md` shifts a specialist up one tier (`fast`→`standard`,
`standard`→`highest`); apply it to the mapping above, and **never run a security-critical specialist at the
`fast` tier**.

## Launching a sub-review

Delegate each brief to the tier's agent (option A) or the mapped built-in agent (option B), passing the brief's
prompt verbatim as the delegation instruction. Pre-flight, reconcile, each specialist, and the coverage sweep
are each one delegated review. `spawn_agents_on_csv` is available for large fan-outs.

## DRY / repo-search specialist

Use Codex's built-in **`explorer`** agent (read-heavy codebase exploration) for the DRY specialist when it's
available — it is search-native, matching this specialist's need for broad repo-wide fan-out. Whichever agent
runs it, DRY MUST perform a **repo-wide `rg` (ripgrep) search** under `REPO_ROOT` for similar
names/logic/constants **before** reporting — an inline diff-only read is a failed DRY pass, not a clean one. Run
it at `highest` tier. Its job is to return locations of existing helpers/patterns, exactly as the DRY brief in
`specialists.md` specifies.

## Concurrency

Governed by `[agents]` in `config.toml`: `max_threads` (default **6**) concurrent subagent threads, `max_depth`
(default **1**, so specialists are direct children and cannot themselves fan out).

- Launch sub-reviews concurrently up to `max_threads`; if `SPECIALISTS` exceeds that, run them in batches of
  `max_threads`. `spawn_agents_on_csv` is available for large fan-outs.
- Phase 1.5 pre-flight + reconcile fit within `max_threads` — start both before awaiting either.
- If `multi_agent` is disabled, run the tiers **sequentially** in the main thread; the review logic is
  unchanged, only slower. Note the sequential fallback on the Phase 4 Coverage line.

## Capabilities summary (for the Phase 4 Coverage line)

- Argument source: invoking prompt (user message text)
- Tier→agent: named agents pin model + effort — project agents `deep-review-{high,standard,fast}` (recommended) or built-in `worker`/`explorer`/`default`
- Repo-wide search: built-in **`explorer`** agent when available, with **mandatory `rg`** either way
- Concurrent sub-reviews: ✓ up to `max_threads` (batch beyond it); sequential fallback if `multi_agent` off
- GitHub-write enforcement: external — a repo-level PreToolUse hook owns `gh` identity; the skill just calls
  `gh` plainly.
