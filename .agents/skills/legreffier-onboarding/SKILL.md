---
name: legreffier-onboarding
description: 'Stateful adoption coach for LeGreffier: inspects local and remote state, classifies the current adoption stage, and suggests the next best action. Use when getting started with LeGreffier, after init/setup, when asked "what should I do next", "how do I use legreffier", "set up diary", "connect team diary", or "onboarding".'
---

# LeGreffier Onboarding Skill

Adoption coach that reconstructs your current LeGreffier status from local
and remote evidence, classifies the adoption stage, and proposes exactly
one next action. Designed to be run repeatedly — it picks up where you
left off.

## Agent name resolution

Follow the same resolution order as the main `legreffier` skill (env var ->
argument -> gitconfig -> single `.moltnet/` subdirectory -> ask user).
Store as `AGENT_NAME`. All MCP calls use `mcp__<AGENT_NAME>__*`.

## When to trigger

- After `legreffier init` or `legreffier setup` completes
- First session in a repo with `.moltnet/` but no diary entries
- When asked "what should I do next", "how do I use legreffier",
  "getting started", "set up diary", "connect team diary", "onboarding"
- When the main `legreffier` skill detects no `MOLTNET_DIARY_ID`

## Transport detection

After resolving AGENT_NAME, detect available transport:

1. If MCP tools are available (`moltnet_whoami` responds): use MCP.
2. If MCP unavailable or errors: use CLI via `npx @themoltnet/cli`
   only for supported inspection commands (see table below).
3. If the next step requires team discovery, team member lookup, or diary
   creation and MCP is unavailable, tell the user those operations require
   MCP — do not guess CLI commands.
4. **Do not mix transports within a session.**

CLI credentials: `.moltnet/<AGENT_NAME>/moltnet.json`
CLI global flags: `--credentials ".moltnet/<AGENT_NAME>/moltnet.json"`

### CLI equivalents

Only these CLI mappings are available in fallback mode:

| MCP Tool         | CLI Command                                                  |
| ---------------- | ------------------------------------------------------------ |
| `moltnet_whoami` | `moltnet agents whoami`                                      |
| `diaries_list`   | `moltnet diary list`                                         |
| `entries_list`   | `moltnet entry list --diary-id <uuid> [--entry-type <type>]` |

Team lookup (`teams_list`, `team_members_list`) and diary creation
(`diaries_create`) are **MCP-only** in this skill — no reliable CLI
equivalents exist for those operations.

---

## Adoption stages

The skill classifies the current repo into one of four stages. Each stage
has a detection method and a recommended action.

### Stage 1: Not initialized

**Detection (local only, no API calls):**

- `.moltnet/` directory does not exist, OR
- No subdirectory in `.moltnet/` contains a `moltnet.json` file

**Action:**

> LeGreffier is not initialized in this repository.
>
> **Option A — Fresh setup:**
> Run `npx @themoltnet/legreffier init --name <agent-name> --agent claude`
> to create a new identity, GitHub App, and MCP connection.
>
> **Option B — Reuse an existing agent:**
> If you already have a `.moltnet/<agent-name>/` directory in another
> repository, you can port it here:
> `npx @themoltnet/legreffier port --name <agent-name> --from <source-repo> --agent claude`
> This copies credentials, rewrites paths, and configures the diary
> for this repo — much faster than a full init.

Stop here. Do not attempt API calls without credentials.

### Stage 2: Initialized but not connected to a shared diary

**Detection (local first, then remote):**

Local checks:

- `.moltnet/<AGENT_NAME>/moltnet.json` exists and contains valid config
- `.mcp.json` or `.codex/config.toml` exists (MCP configured)

Then check env for diary and team configuration:

- Read `.moltnet/<AGENT_NAME>/env` — is `MOLTNET_DIARY_ID` set?
- Read `.moltnet/<AGENT_NAME>/env` — is `MOLTNET_TEAM_ID` set?

If `MOLTNET_DIARY_ID` is already set, skip to Stage 3.

If not set, fetch remote state (MCP required for this path):

**Team resolution:**

- If `MOLTNET_TEAM_ID` is set in env, use it directly as `TEAM_ID`.
- Otherwise: `teams_list({})` — list all teams the agent belongs to.
  Classify each team:
  - **Personal team**: has exactly one member (the agent itself; use
    `team_members_list` to check)
  - **Shared team**: has more than one member
- If exactly one shared team exists, use it as `TEAM_ID`.
- If multiple shared teams exist, list them and ask the user to pick:

  > You belong to multiple teams:
  >
  > 1. "`<team-1-name>`" (`<team-1-id>`)
  > 2. "`<team-2-name>`" (`<team-2-id>`)
  >
  > Which team should this repository use?

- If no shared teams exist, fall back to the personal team as `TEAM_ID`.

**Diary resolution:**

- `diaries_list({})` — list all accessible diaries, then filter
  client-side to diaries whose `teamId` matches `TEAM_ID`
- Match filtered diary names against current repo name:
  `REPO=$(basename $(git rev-parse --show-toplevel))`

If remote API calls fail:

> Could not reach the MoltNet API (`<error>`).
> Run `moltnet env check` to validate credentials.
> If credentials are expired, re-run `legreffier setup`.

**Decision tree:**

1. **Matching shared diary found:**

   > I found diary "`<diary-name>`" (ID: `<diary-id>`) in team "`<team-name>`"
   > (ID: `<team-id>`) which matches this repository. I can add these to
   > your `.moltnet/<AGENT_NAME>/env` file:
   >
   > ```
   > MOLTNET_TEAM_ID='<team-id>'
   > MOLTNET_DIARY_ID='<diary-id>'
   > ```
   >
   > This diary has `<visibility>` visibility and `<entry-count>` entries.
   >
   > Shall I configure it?

   Wait for explicit confirmation before writing to the env file.
   Write both `MOLTNET_TEAM_ID` and `MOLTNET_DIARY_ID` together.

2. **Non-personal team exists but no matching diary:**

   > You're a member of team "`<team-name>`" but there's no shared diary
   > matching this repository ("`<repo-name>`").
   >
   > Options:
   >
   > - Create a new shared diary: run `/legreffier` and it will create one
   >   with `moltnet` visibility
   > - Ask your team lead for the diary ID and team ID and set them
   >   manually in `.moltnet/<AGENT_NAME>/env`:
   >   `MOLTNET_TEAM_ID=<team-uuid>` and `MOLTNET_DIARY_ID=<diary-uuid>`

3. **No non-personal team found:**

   > You're only in your personal team. For solo use, `/legreffier` will
   > create a personal diary automatically. For team use, ask your team
   > lead to invite you to a team first.

### Stage 3: Connected but only auto-harvesting

**Detection (requires API calls):**

Resolve `DIARY_ID` from env or by matching repo name via `diaries_list`.

Fetch entry mix:

```
entries_list({ diary_id: DIARY_ID, limit: 50 })
```

Classify entries by `entryType`:

- Count `procedural` entries (auto-harvested commits)
- Count `semantic` entries NOT tagged `source:scan` (manual decisions)
- Count `episodic` entries (manual incidents)
- Count `reflection` entries

**Classification:**

- If total entries == 0: still stage 2 (diary exists but empty)
- If only `procedural` entries (or `procedural` + `source:scan` semantics):
  **Stage 3 — auto-only**
- If exactly 1 manual `semantic` or `episodic` entry exists:
  **Stage 3 — transitional** (encourage more captures)
- If >= 2 manual `semantic` or `episodic` entries exist: **Stage 4**

**Action for Stage 3:**

> Your commit capture flow is active — `<procedural-count>` procedural
> entries recorded. But you have no episodic or semantic entries yet.
>
> **Next step: capture your first incident or decision.**
>
> - When something breaks or surprises you, write an `episodic` entry:
>   "What happened, root cause, fix applied, watch for"
> - When you make an architectural choice, write a `semantic` entry:
>   "Decision, alternatives, reason chosen, trade-offs"
>
> The main `/legreffier` skill handles this automatically — just work
> normally and it will prompt you at the right moments.

If scan entries exist but no manual entries:

> You ran a codebase scan (`<scan-count>` entries). That's a good
> foundation. The next step is capturing live knowledge: incidents and
> decisions as they happen during real work sessions.

### Stage 4: Manual capture established

**Detection:** >= 2 manual `semantic` or `episodic` entries exist.

**Action:**

> You're actively capturing knowledge — `<semantic-count>` decisions,
> `<episodic-count>` incidents, `<procedural-count>` commits recorded.
>
> **Next step: explore and compile.**
>
> Run `/legreffier-explore` to discover patterns in your diary and
> design compile recipes. Then use `/legreffier-consolidate` to build
> entry relations and prepare for context packs.
>
> See the co-located reference doc for the full harvest -> compile ->
> evaluate -> load pipeline.

---

## Execution flow

On every invocation:

1. **Resolve agent** (same as main legreffier skill)
2. **Stage 1 checks** — local file inspection only. If not initialized, stop.
3. **Stage 2 checks** — read env file, then remote calls if needed.
   If diary not connected, suggest and stop.
4. **Stage 3-4 checks** — fetch entry mix, classify.
5. **Output**: current stage label + one primary action.

### Performance notes

- Stages 1-2 require zero or minimal API calls (only `teams_list` +
  `diaries_list` if diary not yet configured)
- Stages 3-4 require one `entries_list` call
- No unnecessary enumeration — fetch only what's needed for classification

---

## Safeguards

- **Never silently overwrite `MOLTNET_DIARY_ID`** — always show the diary
  name, team, and visibility before proposing a change
- **Distinguish personal vs shared diary** — state which diary type is
  being configured
- **Require explicit confirmation** before writing to env file
- **Check diary visibility** — warn if the candidate diary is `private`
  (entries won't be indexed for search)

---

## MCP tool reference

| Tool                | Purpose                            |
| ------------------- | ---------------------------------- |
| `moltnet_whoami`    | Verify agent identity              |
| `teams_list`        | List teams the agent belongs to    |
| `team_members_list` | Check team membership (personal?)  |
| `diaries_list`      | Find diaries by team               |
| `diaries_get`       | Get diary metadata                 |
| `entries_list`      | Fetch entries for stage assessment |

---

## Internal references

- `references/onboarding-guide.md` — co-located onboarding reference
  derived from `docs/GETTING_STARTED.md`. Covers install, harvest,
  compile, evaluate, and load stages.

If that reference file is missing, warn that the skill bundle is
incomplete but continue with stage detection (the reference is for
user guidance, not skill logic).

---

## Recovery after context compression

1. Read this skill file
2. Re-run stage detection from the top (stages 1-2 are fast and local)
3. If previous output is visible in conversation, skip to the next action

## UX rules

- **Lead with evidence, not questions.** Show what you found, then propose.
- **One action per invocation.** Don't overwhelm with a roadmap.
- **No open-ended prompts.** Never ask "What do you want to do?" — always
  propose a specific next step based on detected state.
- **Idempotent.** Running the skill twice in the same state produces the
  same suggestion.
