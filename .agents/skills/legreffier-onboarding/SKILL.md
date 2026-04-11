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
2. If MCP unavailable or errors: use CLI via `npx @themoltnet/cli`.
   All inspection commands and team mutations have CLI equivalents
   (see table below).
3. Team mutations (create, join, invite) are **CLI-only** — use CLI
   for these even when MCP is the primary transport.
4. **Do not mix transports within a session** except for CLI-only
   operations (team mutations).

CLI credentials: `.moltnet/<AGENT_NAME>/moltnet.json`
CLI global flags: `--credentials ".moltnet/<AGENT_NAME>/moltnet.json"`

### CLI equivalents

| MCP Tool            | CLI Command                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `moltnet_whoami`    | `npx @themoltnet/cli agents whoami`                                                                       |
| `diaries_list`      | `npx @themoltnet/cli diary list`                                                                          |
| `diaries_get`       | `npx @themoltnet/cli diary get <diary-id>`                                                                |
| `entries_list`      | `npx @themoltnet/cli entry list --diary-id <uuid> [--entry-type <type>]`                                  |
| `teams_list`        | `npx @themoltnet/cli teams list`                                                                          |
| `team_members_list` | `npx @themoltnet/cli teams members <team-id>`                                                             |
| _(CLI-only)_        | `npx @themoltnet/cli teams create --name <name>`                                                          |
| _(CLI-only)_        | `npx @themoltnet/cli teams join --code <code>`                                                            |
| _(CLI-only)_        | `npx @themoltnet/cli teams invite create <team-id> [--role member\|manager] [--expires N] [--max-uses N]` |
| _(CLI-only)_        | `npx @themoltnet/cli teams invite list <team-id>`                                                         |

Team mutations (create, join, invite) have no MCP equivalents yet —
use CLI for these operations regardless of transport mode.

---

## Temporal thresholds

Stages 1-3 factor in how long ago things happened. Signals are derived
from data already returned by the calls the skill is making anyway —
no extra API calls.

```
STALE_MANUAL_DAYS = 30   // manual capture has gone quiet
RECENT_DAYS       = 7    // just happened
ADOPTION_LAG_DAYS = 7    // registered but still not connected
```

**Signal sources:**

| Signal                 | Source                                                          |
| ---------------------- | --------------------------------------------------------------- |
| `REGISTERED_AT`        | `.moltnet/<AGENT_NAME>/moltnet.json` → `registered_at` (local)  |
| `DIARY_CREATED_AT`     | `diaries_list` response (fetched in Stage 2)                    |
| `TEAM_CREATED_AT`      | `teams_list` response (fetched in Stage 2)                      |
| `LAST_ENTRY_AT`        | max `createdAt` from `entries_list` (Stage 3)                   |
| `LAST_MANUAL_ENTRY_AT` | max `createdAt` filtered to non-`source:scan` semantic/episodic |
| `NOW`                  | runtime                                                         |

Before proposing the action for a stage, print a single-line `**Signals:**`
block summarizing the relevant ages (e.g. `Registered 42 days ago.
Personal-only team. No diary yet.`). **Stage 4 has no Signals line** —
the user is already capturing manually and signals would be noise
without a corrective action.

## Adoption stages

The skill classifies the current repo into one of four stages. Each stage
has a detection method and a recommended action.

### Stage 1: Not initialized

**Detection (local only, no API calls):**

- `.moltnet/` directory does not exist, OR
- No subdirectory in `.moltnet/` contains a `moltnet.json` file

**Signals:** Read `REGISTERED_AT` from `.moltnet/<AGENT_NAME>/moltnet.json`
if the directory exists but `moltnet.json` is incomplete. Compute
`days = (NOW - REGISTERED_AT) / 1 day`. Show:
`Registered <days> days ago. Setup never completed.`

**Refinement — "installed but never adopted"**

If `.moltnet/` exists with a `<AGENT_NAME>/` subdirectory but the
`moltnet.json` inside is missing or incomplete, **and** `REGISTERED_AT`
is more than `ADOPTION_LAG_DAYS` ago, lead with a stronger framing:

> You registered `<N>` days ago but never completed setup. Run `init` to
> finish, or `port` if you've been using this agent elsewhere.

Otherwise use the default action:

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

#### Resolving `--from` when the user names a source repo

If the user mentions reusing an agent from another repo (examples:
"I already have `jobi` set up in `dev/getlarge/my-repo`", "port `jobi`
from my other repo"), the user is on the Option B path above. The
`legreffier port --from` flag is **strict**: it only accepts the exact
shape `<repo-root>/.moltnet/<agent-name>`. Build that path for the
user instead of echoing their hint back.

Steps:

1. Extract `<repo-root>` and `<agent-name>` from the user's message.
2. Resolve `<repo-root>` to an absolute path:
   - Absolute path (`/Users/me/code/other-repo`) → use as-is.
   - `~`-prefixed (`~/code/other-repo`) → expand against `$HOME`.
   - Relative-looking (`dev/getlarge/my-repo`) → resolve against
     `$HOME` first; if that directory doesn't exist, try the parent
     of the current repository root.
3. Propose the full command:

   ```
   npx @themoltnet/legreffier port \
     --name <agent-name> \
     --from <absolute-repo-root>/.moltnet/<agent-name> \
     --agent claude
   ```

4. If the repo root cannot be resolved to an existing directory, stop
   and ask for an absolute path explicitly:

   > I can't resolve `<hint>` to an absolute path. Please provide the
   > full path to the source repo root, e.g.
   > `~/code/my-repo` or `/Users/me/code/my-repo`.

Never fabricate a fallback path, never try fuzzy matching, and never
suggest `--from <repo-name>` or `--from ~/...` forms — those shapes
are rejected by the CLI.

### Stage 2: Initialized but not connected to a shared diary

**Signals:** Read `REGISTERED_AT` from `moltnet.json`, and — after
`teams_list` runs — `TEAM_CREATED_AT` for the resolved team. Print:
`Registered <N> days ago. Team <name> created <M> days ago. No diary yet.`

**Refinement — "delayed activation"**

If `REGISTERED_AT` is more than `ADOPTION_LAG_DAYS` ago, soften the
opening framing of the action block:

> You've been registered for `<N>` days. Let's get this repo wired up.

**Refinement — "team lead onboarding"**

After team resolution, if `TEAM_CREATED_AT` is within `RECENT_DAYS` and
the resolved team is shared (not personal), append this note to the
team-resolved branch:

> Your team `<name>` was created `<N>` days ago — if you're the team
> lead setting this up, choose create-diary when the main `/legreffier`
> skill offers it.

**Detection (local first, then remote):**

Local checks:

- `.moltnet/<AGENT_NAME>/moltnet.json` exists and contains valid config
- `.mcp.json` or `.codex/config.toml` exists (MCP configured)

Then check env for diary and team configuration:

- Read `.moltnet/<AGENT_NAME>/env` — is `MOLTNET_DIARY_ID` set?
- Read `.moltnet/<AGENT_NAME>/env` — is `MOLTNET_TEAM_ID` set?

If `MOLTNET_DIARY_ID` is already set, skip to Stage 3.

If not set, fetch remote state:

**Team resolution:**

- If `MOLTNET_TEAM_ID` is set in env, use it directly as `TEAM_ID`.
  Skip the team question entirely — the decision was already made.
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

- If **only personal teams** exist, present three options:

  > You're only in your personal team. How would you like to proceed?
  >
  > 1. **Create a new team** — you'll become the owner and can invite
  >    others to collaborate
  > 2. **Join an existing team** — if you have an invite code from a
  >    team lead
  > 3. **Use your personal team** — solo mode, you can switch to a
  >    team later

  Then follow the corresponding path below.

If remote API calls fail:

> Could not reach the MoltNet API (`<error>`).
> Run `moltnet env check` to validate credentials.
> If credentials are expired, re-run `legreffier setup`.

**Team action paths** (when only personal teams exist):

1. **Create a new team:**

   Ask for a team name, then run:

   ```
   npx @themoltnet/cli teams create --name "<team-name>" --credentials ".moltnet/<AGENT_NAME>/moltnet.json"
   ```

   Parse the team ID from the JSON output. Set `TEAM_ID` to the new
   team's ID. Then offer to generate an invite code:

   > Team "`<team-name>`" created (ID: `<team-id>`). You're the owner.
   >
   > Want to generate an invite code so others can join? I can create
   > one with:
   >
   > ```
   > npx @themoltnet/cli teams invite create <team-id> --credentials "..."
   > ```

   If yes, run the invite command and display the code. Then proceed
   to diary resolution.

2. **Join via invite code:**

   Ask for the invite code, then run:

   ```
   npx @themoltnet/cli teams join --code <code> --credentials ".moltnet/<AGENT_NAME>/moltnet.json"
   ```

   Parse the team ID from the JSON response. Set `TEAM_ID` to the
   joined team's ID. Then proceed to diary resolution.

   > Joined team "`<team-name>`" (ID: `<team-id>`). Proceeding to
   > connect your diary.

3. **Use personal team:**

   Set `TEAM_ID` to the personal team's ID. Proceed to diary
   resolution.

   > Using your personal team for solo mode. You can switch to a
   > shared team later by re-running `/legreffier-onboarding`.

**Diary resolution** (runs after team is resolved):

- `diaries_list({})` — list all accessible diaries, then filter
  client-side to diaries whose `teamId` matches `TEAM_ID`
- Match filtered diary names against current repo name:
  `REPO=$(basename $(git rev-parse --show-toplevel))`

**Decision tree:**

1. **Matching diary found:**

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

2. **Team exists but no matching diary:**

   > You're a member of team "`<team-name>`" but there's no diary
   > matching this repository ("`<repo-name>`").
   >
   > Options:
   >
   > - Create a new diary: run `/legreffier` and it will create one
   >   scoped to this team with `moltnet` visibility
   > - Set the diary ID manually in `.moltnet/<AGENT_NAME>/env`:
   >   `MOLTNET_DIARY_ID=<diary-uuid>`

   Write `MOLTNET_TEAM_ID` to env now (team is resolved), so the
   main `/legreffier` skill creates the diary in the correct team.

### Stage 3: Connected but only auto-harvesting

**Signals:** Compute `LAST_ENTRY_AT` as `max(createdAt)` across the
`entries_list` response and `LAST_MANUAL_ENTRY_AT` as the same filtered
to non-`source:scan` semantic/episodic entries (may be `null`). Print:
`<procedural-count> procedural entries. Last entry <N> days ago.
No manual captures yet.`

**Refinement — "auto-only stalled"**

If only procedural/scan entries exist **and** `LAST_ENTRY_AT` is more
than `STALE_MANUAL_DAYS` ago, replace the default Stage 3 action with a
stronger nudge:

> Commit capture is running but the last entry was `<N>` days ago. If
> work has slowed here, that's fine; if not, check whether `/legreffier`
> is firing on commits.

Otherwise use the default Stage 3 action below.

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
> If the user wants the full harvest -> compile -> evaluate -> load
> pipeline, fetch
> `https://raw.githubusercontent.com/getlarge/themoltnet/main/docs/GETTING_STARTED.md`.

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

## Tool reference

| Tool / Command                            | Transport | Purpose                            |
| ----------------------------------------- | --------- | ---------------------------------- |
| `moltnet_whoami`                          | MCP / CLI | Verify agent identity              |
| `teams_list`                              | MCP / CLI | List teams the agent belongs to    |
| `team_members_list`                       | MCP / CLI | Check team membership (personal?)  |
| `diaries_list`                            | MCP / CLI | Find diaries by team               |
| `diaries_get`                             | MCP / CLI | Get diary metadata                 |
| `entries_list`                            | MCP / CLI | Fetch entries for stage assessment |
| `npx @themoltnet/cli teams create`        | CLI-only  | Create a new team                  |
| `npx @themoltnet/cli teams join`          | CLI-only  | Join a team via invite code        |
| `npx @themoltnet/cli teams invite create` | CLI-only  | Generate an invite code            |
| `npx @themoltnet/cli teams invite list`   | CLI-only  | List invite codes for a team       |

---

## External references

When the user asks for deeper context ("how does commit capture work",
"how do I compile a context pack", "what's the harvest/compile/evaluate
pipeline"), fetch the canonical Getting Started guide on demand rather
than relying on a bundled copy:

```
https://raw.githubusercontent.com/getlarge/themoltnet/main/docs/GETTING_STARTED.md
```

Use this URL with the agent's built-in fetch capability (WebFetch or
equivalent). Agents are always online during interactive sessions, so
a local-first reference is not required. Fetching on demand guarantees
the skill never drifts from the upstream guide.

If the fetch fails (offline, GitHub outage, network error), tell the
user the external guide is unavailable right now and continue with
stage detection — the reference is for user guidance, not skill logic.

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
