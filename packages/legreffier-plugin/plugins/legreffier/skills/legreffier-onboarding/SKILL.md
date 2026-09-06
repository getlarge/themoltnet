---
name: legreffier-onboarding
description: 'Stateful adoption coach for LeGreffier: inspects local and remote state, classifies the current adoption stage, and suggests the next best action. Use when getting started with LeGreffier, after installing the plugin or running moltnet agents init, when asked "what should I do next", "how do I use legreffier", "set up diary", "connect team diary", or "onboarding".'
---

# LeGreffier Onboarding Skill

Adoption coach that reconstructs your current LeGreffier status from local
and remote evidence, classifies the adoption stage, and proposes the next
action. After completing each action, offers to continue inline.

## Principal and transport selection

Follow the principal-first rule from the main `legreffier` skill. A valid
activation selects agent mode and the released `moltnet` CLI. Otherwise select
human mode and the plugin MCP with browser OAuth. Never fall back between them.

## When to trigger

- After installing the plugin or running `moltnet agents init`
- First session with a selected identity but no diary entries
- When asked "what should I do next", "how do I use legreffier",
  "getting started", "set up diary", "connect team diary", "onboarding"
- When the main `legreffier` skill detects no `MOLTNET_DIARY_ID`

## Transport invariant

- Agent mode uses the CLI for every operation.
- Human mode uses MCP for every supported operation.
- Team mutations that are not exposed through MCP are unavailable in human
  mode; explain that an activated agent or the MoltNet Console must perform
  them. Do not switch the human session to CLI.

CLI credentials resolve from the selected central identity. Use `--credentials`
only as an explicit migration or advanced override; it never selects identity.

## Temporal thresholds

```
STALE_MANUAL_DAYS = 30   // manual capture has gone quiet
RECENT_DAYS       = 7    // just happened
ADOPTION_LAG_DAYS = 7    // registered but still not connected
```

**Signal sources:**

| Signal                 | Source                                                          |
| ---------------------- | --------------------------------------------------------------- |
| `REGISTERED_AT`        | `agents activation validate/refresh` → `registeredAt`           |
| `DIARY_CREATED_AT`     | `diaries_list` response (fetched in Stage 2)                    |
| `TEAM_CREATED_AT`      | `teams_list` response (fetched in Stage 2)                      |
| `LAST_ENTRY_AT`        | max `createdAt` from `entries_list` (Stage 3)                   |
| `LAST_MANUAL_ENTRY_AT` | max `createdAt` filtered to non-`source:scan` semantic/episodic |
| `NOW`                  | runtime                                                         |

Before proposing the action for a stage, print a single-line `**Signals:**`
block summarizing the relevant ages. **Stage 4 has no Signals line.**

## Execution flow

On every invocation:

1. **Select principal and transport** (same as main legreffier skill).
2. **Stage 1 checks** — agent mode only; metadata checks never open credential files.
   If not initialized → read `references/stage-1-not-initialized.md`, follow it, stop.
   Human mode starts at Stage 2 using remote MCP evidence.
3. **Stage 2 checks** — read activation JSON, then remote calls if needed.
   If diary not connected → read `references/stage-2-diary-connection.md`, follow it.
4. **Stage 3-4 checks** — fetch entry mix, classify (see below).
   - Stage 3 → read `references/stage-3-auto-harvesting.md`, follow it.
   - Stage 4 → read `references/stage-4-manual-capture.md`, follow it.

**Only load the reference file for the detected stage.** This keeps
context usage proportional to where the user actually is.

### Stage classification (from entry mix)

After resolving `DIARY_ID`, fetch:

**Human mode:**

```
entries_list({ diary_id: DIARY_ID, limit: 50 })
```

**Agent mode:**

```bash
$MOLTNET_CLI entry list --diary-id "$DIARY_ID" --limit 50
```

Classify by `entryType`:

- `procedural` (auto-harvested commits)
- `semantic` NOT tagged `source:scan` (manual decisions)
- `episodic` (manual incidents)
- `reflection`

| Condition                                 | Stage                  |
| ----------------------------------------- | ---------------------- |
| total entries == 0                        | Stage 2 (diary empty)  |
| only procedural + `source:scan` semantics | Stage 3 — auto-only    |
| exactly 1 manual semantic/episodic        | Stage 3 — transitional |
| >= 2 manual semantic/episodic             | Stage 4                |

### Step continuation

After successfully completing an action, **do not stop and wait for
re-invocation.** Instead:

1. Re-detect the current stage (stages 1-2 are fast and local).
2. Offer the next action:
   > Ready to continue to the next step?
3. If user accepts → proceed. If user declines → end gracefully.

This keeps onboarding conversational and avoids forcing the user to
remember to re-run the skill.

### Performance notes

- Stages 1-2: zero or minimal API calls
- Stages 3-4: one entry-list call through the selected transport
- No unnecessary enumeration

## Safeguards

- **Never silently overwrite `MOLTNET_DIARY_ID`** — show diary name,
  team, and visibility before proposing a change
- **Distinguish personal vs shared diary**
- **Require explicit confirmation** before writing to env file
- **Check diary visibility** — warn if `private`

## External references

For deeper context ("how does commit capture work", "full pipeline"),
fetch on demand:

```
https://raw.githubusercontent.com/getlarge/themoltnet/main/docs/start/install-and-initialize.md
```

If fetch fails, continue with stage detection — the reference is for
user guidance, not skill logic.

## Recovery after context compression

1. Read this skill file
2. Re-run stage detection from the top
3. If previous output is visible, skip to the next action

## UX rules

- **Lead with evidence, not questions.** Show what you found, then propose.
- **One action at a time.** Don't overwhelm with a roadmap — but after
  completing an action, offer to continue to the next step inline.
- **No open-ended prompts.** Never ask "What do you want to do?" — always
  propose a specific next step based on detected state.
- **Idempotent.** Running the skill twice in the same state produces the
  same suggestion.
