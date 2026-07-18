# deep-review execution adapter — Claude Code

Bindings for running deep-review in **Claude Code**. The core (`SKILL.md`) and briefs
(`preflight.md`, `reconcile.md`, `specialists.md`) describe review **tiers** and **capabilities**; this file
maps them to concrete Claude Code mechanisms. Load this once, before Phase 1.5.

## Argument source

The review target and flags arrive via `$ARGUMENTS` (expanded by Claude Code at skill invocation).

## Tier → model

Resolve each specialist/sub-review tier to a model on the Agent call:

| Tier       | Model    |
| ---------- | -------- |
| `highest`  | `opus`   |
| `standard` | `sonnet` |
| `fast`     | `haiku`  |

The security-critical upgrade in `specialists.md` shifts a specialist up one tier (`fast`→`standard`,
`standard`→`highest`); apply it to the model above, and **never run a security-critical specialist on `haiku`**.

## Launching a sub-review

Use the **Agent tool**. Unless a row below says otherwise, every sub-review uses
`subagent_type: general-purpose` with the `model` from the tier table, passing the brief's prompt verbatim.

| Sub-review                        | subagent_type     | model                                     |
| --------------------------------- | ----------------- | ----------------------------------------- |
| Pre-flight (`preflight.md`)       | `general-purpose` | `opus` (tier `highest`)                   |
| Reconcile (`reconcile.md`)        | `general-purpose` | `sonnet` (tier `standard`)                |
| Correctness, Security, Design/API | `general-purpose` | `opus`                                    |
| Performance, Operability          | `general-purpose` | `sonnet` (→ `opus` if security-critical)  |
| Tests, Readability                | `general-purpose` | `haiku` (→ `sonnet` if security-critical) |
| Coverage sweep                    | `general-purpose` | `sonnet`                                  |

## DRY / repo-search specialist

DRY is a **repo-wide search**, not a diff read. On Claude Code use `subagent_type: Explore` — a search-native
agent whose strength is broad fan-out across files and naming conventions. **Do not** set `model:` on an
`Explore` call; its own default applies. Explore returns locations, so the DRY brief's "search for existing
helpers/constants/patterns" maps directly onto it.

## Concurrency

Claude Code runs sub-reviews concurrently when **multiple Agent calls are issued in a single message**.

- Phase 1.5: launch pre-flight + reconcile (when `MODE=pr`) as two Agent calls in **one** message.
- Phase 3: launch every specialist in `SPECIALISTS` as multiple Agent calls in **one** message.

There is no fixed cap to plan around here; issue them together and let the runtime schedule. Sequential
fallback is unnecessary on this harness.

## Capabilities summary (for the Phase 4 Coverage line)

- Argument source: `$ARGUMENTS` ✓
- Tier→model: opus / sonnet / haiku ✓
- Repo-wide search: `Explore` agent ✓
- Concurrent sub-reviews: ✓ (multiple Agent calls per message)
- GitHub-write enforcement: external — a repo-level PreToolUse hook owns `gh` identity; the skill just calls
  `gh` plainly.
