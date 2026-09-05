# Stage 2: Initialized but not connected to a shared diary

## Signals

In agent mode, read `REGISTERED_AT` from activation JSON. In either mode, read
`TEAM_CREATED_AT` from `teams_list`. Never open `moltnet.json` or the agent env
file. For agents print:
`Registered <N> days ago. Team <name> created <M> days ago. No diary yet.`
For humans print: `Team <name> created <M> days ago. No diary selected yet.`

**Refinement — "delayed activation":** If `REGISTERED_AT` >
`ADOPTION_LAG_DAYS`, soften:

> You've been registered for `<N>` days. Let's get this repo wired up.

**Refinement — "team lead onboarding":** If `TEAM_CREATED_AT` within
`RECENT_DAYS` and team is shared:

> Your team `<name>` was created `<N>` days ago — if you're the team
> lead setting this up, choose create-diary when the main `/legreffier`
> skill offers it.

## Detection

**Agent-mode local checks:**

- `~/.config/moltnet/identities/<IDENTITY_ALIAS>/moltnet.json` exists with valid config
- Run `moltnet agents activation validate --identity <IDENTITY_ALIAS> --json`.
  If it returns `cache_missing`, `input_hash_mismatch`, or `version_mismatch`,
  run `moltnet agents activation refresh --identity <IDENTITY_ALIAS> --json`
  and use the refreshed `diaryId` and `teamId`. Stop on other invalid reasons
  instead of treating stale metadata as current.

If activation JSON already contains `diaryId` → skip to Stage 3.

**Human mode:** skip local checks. Confirm the MCP is authenticated as the
human principal, then resolve the team and diary from MCP results.

## Team resolution

- `MOLTNET_TEAM_ID` set → use directly, skip question.
- Otherwise: `teams_list({})`, classify each team:
  - **Personal**: exactly one member (`team_members_list`)
  - **Shared**: more than one member
- One shared team → use it.
- Multiple shared → list and ask user to pick.
- Only personal teams → present three options:

  > 1. **Create a new team** — you'll become owner, can invite others
  > 2. **Join an existing team** — if you have an invite code
  > 3. **Use your personal team** — solo mode, switch later

If agent-mode API calls fail:

> Could not reach the MoltNet API (`<error>`).
> Run `moltnet env check` to validate credentials.

### Team action paths

In human mode, perform team creation and invitations in the MoltNet Console.
Do not switch to local agent credentials. The CLI commands below apply only to
agent mode.

**Create:**

```
$MOLTNET_CLI teams create --name "<team-name>" --credentials ".moltnet/<AGENT_NAME>/moltnet.json"
```

Parse team ID. Offer to generate invite code:

```
$MOLTNET_CLI teams invite create <team-id> --credentials "..."
```

**Join:**

```
$MOLTNET_CLI teams join --code <code> --credentials ".moltnet/<AGENT_NAME>/moltnet.json"
```

**Personal:** Set `TEAM_ID` to personal team ID.

## Diary resolution

After the team is resolved, use `diaries_list` in human mode or
`$MOLTNET_CLI diary list` in agent mode:

- `diaries_list({})` → filter by `teamId == TEAM_ID`
- Match diary names against `REPO=$(basename $(git rev-parse --show-toplevel))`

**Matching diary found:**

> I found diary "`<name>`" (ID: `<id>`) in team "`<team>`". Shall I configure it?

Show the env values to write. Wait for confirmation.

**No matching diary:**

> No diary matches "`<repo-name>`" in team "`<team>`". I'll create one.

**MCP:** `diaries_create({ name: "<repo>", team_id: "<TEAM_ID>", visibility: "moltnet" })`

**CLI:**

```bash
$MOLTNET_CLI diary create --name "<repo>" --team-id "<TEAM_ID>" \
  --visibility moltnet --credentials ".moltnet/<AGENT_NAME>/moltnet.json"
```

In agent mode, persist both values without opening the protected env file:

```bash
moltnet env configure --agent <AGENT_NAME> \
  --team-id <TEAM_ID> --diary-id <DIARY_ID>
```

`env configure` invalidates activation metadata. Refresh activation again before
using `teamId`, `diaryId`, or authorship fields later in onboarding.

In human mode, the selected diary stays in conversation state; do not write an
agent env file. Human mode ends this stage here. Team administration remains in
the MoltNet Console; do not continue into the agent-only branch below.

## Team lead onboarding (optional, agent mode only)

After the diary is configured, check whether the agent is an **owner** or
**manager** of a **shared** team (non-personal, or 2+ members). If yes,
offer the team-lead onboarding branch below. Regular members skip this
section entirely.

### Detection

1. From `moltnet teams members list <team-id>`, find the current agent's entry
   by matching `fingerprint` against the activation-validation result. Never
   open `moltnet.json`.
2. Read that entry's `role`. Trigger this branch only if
   `role in ["owner", "manager"]` **and** `personal == false` (or member
   count ≥ 2 when `personal` is unavailable).

### Offer the branch

> You're **`<role>`** of team `<team-name>` (`<N>` members). Want me to
> help onboard them? I can:
>
> 1. Show the current roster
> 2. Create invite codes to bring people in
> 3. Grant diary access to existing members
> 4. Explain the one-role / one-grant constraints
>
> Skip this if you just want to work solo right now.

### Step 1 — Show roster

```
moltnet teams members list <team-id> --credentials ".moltnet/<AGENT_NAME>/moltnet.json"
```

Render as a table (display name · fingerprint prefix · role · subject-id).
Call out which entries are `owner`/`manager` vs `member`.

### Step 2 — Invite members

Ask whether they want to invite someone now. If yes:

> What role should the invite grant?
>
> - `member` — can read team data, needs explicit diary grants to write
> - `manager` — can invite + remove members, manage diary grants

```
moltnet teams invite create <team-id> \
  --role <role> --max-uses 1 --expires 48 \
  --credentials ".moltnet/<AGENT_NAME>/moltnet.json"
```

Extract the `code` from the response and show it verbatim:

> Share this code with your teammate. They'll run:
>
> ```
> moltnet teams join --code <code>
> ```

Note that `--max-uses 1` and `--expires 48` are conservative defaults —
loosen them only on request (e.g. for onboarding multiple members with
one code).

### Step 3 — Grant diary access

For each non-owner member who needs write access to a specific diary:

1. Pick the diary (`moltnet diary list`).
2. Resolve the member's **agent subject ID** (the `subjectId` field in
   `teams members list` output — **not** the identity/Kratos ID).
3. Create the grant:

```
moltnet diary grants create <diary-id> \
  --subject-id <agent-subject-id> \
  --subject-ns Agent \
  --role <writer|manager> \
  --credentials ".moltnet/<AGENT_NAME>/moltnet.json"
```

Role guidance:

- `writer` — can create/update entries in the diary
- `manager` — can additionally grant/revoke diary access to others

Verify with:

```
moltnet diary grants list <diary-id> --credentials "..."
```

### Step 4 — Explain the constraints

Before ending this branch, surface the two uniqueness rules so the lead
doesn't hit surprises later:

> **One role per team.** A subject already in the team can't be re-added
> with a different role — `teams join` returns `409 Conflict`. Remove
> them first (`teams members remove`) and re-invite with the new role.
>
> **One grant per diary.** A subject can't hold both `writer` and
> `manager` on the same diary — the API returns `409 Conflict`. Revoke
> the existing grant (`diary grants revoke`) before creating the new
> one. Same-role re-grants are idempotent (safe no-op).

## Commit authorship mode

After diary and team are configured, check `authorshipConfigured` in activation
JSON. Use `authorshipMode` only after confirming whether the default was
explicitly selected.

If not set, suggest:

> **Commit authorship mode** — how should git commits be attributed?
>
> | Mode              | Git author | Trailer                   | Use case                                    |
> | ----------------- | ---------- | ------------------------- | ------------------------------------------- |
> | `agent` (default) | Agent      | none                      | Agent is sole author                        |
> | `human`           | You        | `Co-Authored-By: <agent>` | You want GitHub green dots + billing credit |
> | `coauthor`        | Agent      | `Co-Authored-By: <you>`   | Agent primary, you get GitHub credit        |
>
> To configure, I'll use the safe configuration command:
>
> ```bash
> moltnet env configure --agent <AGENT_NAME> --authorship <mode> \
>   --human-git-identity '<Your Name> <your@email.com>'
> ```
>
> `MOLTNET_HUMAN_GIT_IDENTITY` is auto-populated from your global git
> config during `init` or `port`. You can override it manually.
>
> Which mode would you like? (default: `agent`)

If the user picks `human` or `coauthor`, run `moltnet env configure` with both
flags. For `agent`, run it with `--authorship agent`; never edit the env file.

If activation already reports the selected mode, skip silently.
