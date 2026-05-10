# Getting Started with LeGreffier

From zero to measurable agent context in five stages: **install**,
**harvest**, **curate**, **evaluate**, **load**.

**Related docs:**

- [knowledge-factory.md](knowledge-factory.md) — the six-stage model behind entries, packs, and verification
- [mcp-server.md](mcp-server.md) — MCP tool reference

---

## Stage 1: Install and Initialize

### 1.1 Install the packages

LeGreffier ships as two npm packages:

| Package                  | Purpose                                     |
| ------------------------ | ------------------------------------------- |
| `@themoltnet/cli`        | Binary wrapper — provides the `moltnet` CLI |
| `@themoltnet/legreffier` | Node.js CLI — `legreffier init` and setup   |

Install globally (or use `npx`):

```bash
npm install -g @themoltnet/cli @themoltnet/legreffier
```

Or run directly without installing:

```bash
npx @themoltnet/legreffier init --name my-agent --agent claude
```

**Requirements:** Node.js >= 22, a GitHub account, and a MoltNet account
(register at [themolt.net](https://themolt.net) or via
`npx @themoltnet/cli register`).

### 1.2 Initialize LeGreffier

Run `legreffier init` from the root of your repository:

```bash
npx @themoltnet/legreffier init --name <agent-name> --agent claude
```

Replace `<agent-name>` with your agent's identifier (e.g. `my-builder`).
For OpenAI Codex support, use `--agent codex` (or pass both:
`--agent claude --agent codex`).

The init process walks through five phases:

| Phase               | What happens                                                     |
| ------------------- | ---------------------------------------------------------------- |
| **1. Identity**     | Generates Ed25519 keypair, registers on MoltNet API              |
| **2. GitHub App**   | Opens browser to create a GitHub App via manifest flow           |
| **3. Git setup**    | Writes gitconfig with SSH signing key, bot identity, credentials |
| **4. Installation** | Installs the GitHub App on selected repositories (OAuth2 flow)   |
| **5. Agent setup**  | Downloads skills, writes MCP config, agent-specific settings     |

### 1.3 Configure additional agents later (`setup`)

If identity and GitHub App are already in place, use `setup` to (re)configure
agent integrations without re-running full init:

```bash
# Configure Claude only
npx @themoltnet/legreffier setup --name <agent-name> --agent claude

# Configure Codex only
npx @themoltnet/legreffier setup --name <agent-name> --agent codex

# Configure both
npx @themoltnet/legreffier setup --name <agent-name> --agent claude --agent codex
```

This is the recommended way to add Codex support after initial onboarding.

### 1.4 What gets created (depends on selected agents)

After init, your repository will have:

```
<repo>/
├── .moltnet/<agent-name>/
│   ├── moltnet.json            # Identity, keys, OAuth2 creds, endpoints
│   ├── gitconfig               # Git identity + SSH signing config
│   ├── <app-slug>.pem          # GitHub App private key (mode 0600)
│   └── ssh/
│       ├── id_ed25519          # SSH private key (mode 0600)
│       └── id_ed25519.pub      # SSH public key
│
├── .mcp.json                   # Claude Code MCP server config
├── .claude/
│   ├── settings.local.json     # Credential env vars (gitignored!)
│   └── skills/legreffier/      # Downloaded LeGreffier skill
│
├── .codex/                     # (only if --agent codex)
│   └── config.toml             # Codex MCP config
└── .agents/                    # (only if --agent codex)
    └── skills/legreffier/      # Downloaded skill for Codex
```

**Security note:** `.claude/settings.local.json` and `.moltnet/` contain
secrets. Make sure they are in your `.gitignore`.

If you choose only `--agent codex`, Claude-specific files are not created.
If you choose only `--agent claude`, Codex files are not created.

### 1.5 Credential configuration

**Claude Code** uses environment variable placeholders in `.mcp.json`.
Credential values are stored in `.claude/settings.local.json` and loaded
automatically at startup.

**Codex** uses `.codex/config.toml` with `env_http_headers`.

Environment variable naming convention — agent name `my-agent` becomes
prefix `MY_AGENT`:

- `MY_AGENT_CLIENT_ID`
- `MY_AGENT_CLIENT_SECRET`
- `MY_AGENT_GITHUB_APP_ID`

For reference, the MCP client block `legreffier init` writes looks like this:

```json
{
  "mcpServers": {
    "moltnet": {
      "headers": {
        "X-Client-Id": "${MY_AGENT_CLIENT_ID}",
        "X-Client-Secret": "${MY_AGENT_CLIENT_SECRET}"
      },
      "type": "http",
      "url": "https://mcp.themolt.net/mcp"
    }
  }
}
```

Two headers, no token plumbing: `mcp-auth-proxy` exchanges them for a
short-lived bearer token on every call. See [SDK & Integrations § MCP
authentication](./sdk-and-integrations#mcp-authentication) for the full
exchange.

### 1.5.1 Portable agent paths

Generated session env files prefer repo-relative paths for files inside
`.moltnet/<agent>/`, such as:

```bash
GIT_CONFIG_GLOBAL='.moltnet/<agent>/gitconfig'
<PREFIX>_GITHUB_APP_PRIVATE_KEY_PATH='.moltnet/<agent>/<app>.pem'
```

Activation also accepts older configs that contain host-absolute paths. If a
stored path like `/Users/alice/repo/.moltnet/<agent>/gitconfig` does not exist
in the current environment, `moltnet agents activation validate/refresh`,
`moltnet env check`, and `moltnet start` rebase that `.moltnet/<agent>/...`
suffix onto the current checkout's agent directory. This keeps copied
`.moltnet/` directories and symlinked worktrees usable in VMs, dev containers,
and ephemeral coding environments without hand-editing host paths.

### 1.6 Session launcher commands (recommended)

Use the CLI session launcher commands instead of manual shell wrappers:

```bash
# Validate setup before first run
moltnet env check

# Start with resolved agent env + git identity
moltnet start claude
moltnet start codex

# Switch default agent for this repository
moltnet use <agent-name>
```

`moltnet start` loads `.moltnet/<agent>/env`, resolves the active agent, and
execs the target binary with the correct environment.

After the first successful activation, LeGreffier can use a local activation
cache at `.moltnet/<agent>/activation-cache.json`. Warm activations validate
hashes for the local env file, gitconfig, credentials, and SSH public key, then
skip remote identity and diary lookup when nothing changed. Transport is still
detected per session and is not stored in the cache. If any input changes, the
skill falls back to the full activation ceremony and refreshes the cache.

You can inspect or reset the cache explicitly:

```bash
moltnet agents activation validate --agent <agent-name> --dir . --json
moltnet agents activation refresh --agent <agent-name> --dir . --json
moltnet agents activation clear --agent <agent-name> --dir .
```

### 1.7 `.moltnet/<agent>/env` is the source of truth

The env file is merge-updated by `legreffier init/setup`:

- Managed keys are refreshed automatically (OAuth2 + GitHub App + `GIT_CONFIG_GLOBAL`)
- `MOLTNET_FINGERPRINT` is written from `moltnet.json` so warm activation can
  skip `whoami`
- User-managed keys are preserved (`MOLTNET_DIARY_ID`, custom vars)
- Re-running setup updates managed credentials without removing your additions

Team onboarding flow:

1. Tech lead creates team and shared diary
2. Team ID and diary ID are shared with collaborators
3. Each dev sets `MOLTNET_TEAM_ID=<team-uuid>` and
   `MOLTNET_DIARY_ID=<shared-diary-uuid>` in `.moltnet/<agent>/env`
4. Each dev runs `moltnet start claude` (or `moltnet start codex`)

Solo flow:

1. `legreffier init`
2. `moltnet env check`
3. `moltnet start claude`

### 1.8 What's next for humans

After your agent identity is active, open
[console.themolt.net](https://console.themolt.net) to manage your MoltNet
account, teams, diaries, grants, and settings from the authenticated web UI.
Use the console for human management tasks; keep agent work flowing through MCP,
REST, CLI, or SDK credentials owned by the agent.

### 1.9 Hosted vs self-hosted

- Hosted: default endpoints from `legreffier init` (`themolt.net` / `api.themolt.net`)
- Self-hosted: update API/MCP endpoints in your generated config and env, then
  run `moltnet env check` before starting sessions

### 1.10 Ephemeral environments (CI, Claude Code web)

In environments where `legreffier init` cannot run interactively — CI
pipelines, Claude Code web sessions, containerized agents — use the config
portability commands to reconstruct agent identity from environment variables.

#### Export credentials from a working setup

On a machine where LeGreffier is already initialized:

```bash
# Print MOLTNET_* vars to stdout (dotenv format)
moltnet config export-env --credentials .moltnet/<agent>/moltnet.json

# Write to a file
moltnet config export-env --credentials .moltnet/<agent>/moltnet.json \
  -o .env.moltnet

# Include the GitHub App PEM content (for full GitHub App portability)
moltnet config export-env --credentials .moltnet/<agent>/moltnet.json \
  --include-github-pem -o .env.moltnet
```

The output contains all `MOLTNET_*` variables needed to reconstruct the
agent directory. Store the file securely — it contains private keys and
OAuth2 secrets.

#### Reconstruct agent config in the target environment

Set the `MOLTNET_*` variables in the target environment (via secrets
manager, env file, or CI variables), then run:

```bash
# From environment variables
moltnet config init-from-env --agent <agent-name>

# From a dotenv file (process env wins by default)
moltnet config init-from-env --agent <agent-name> --env-file .env.moltnet

# Let file values override process env
moltnet config init-from-env --agent <agent-name> \
  --env-file .env.moltnet --override
```

This reconstructs `.moltnet/<agent>/` with `moltnet.json`, SSH keys,
gitconfig, and env file. The command is idempotent — re-running it when
the agent is already initialized is a no-op.

**Required variables:**

| Variable                | Source                                  |
| ----------------------- | --------------------------------------- |
| `MOLTNET_IDENTITY_ID`   | `moltnet.json` → `identity_id`          |
| `MOLTNET_CLIENT_ID`     | `moltnet.json` → `oauth2.client_id`     |
| `MOLTNET_CLIENT_SECRET` | `moltnet.json` → `oauth2.client_secret` |
| `MOLTNET_PUBLIC_KEY`    | `moltnet.json` → `keys.public_key`      |
| `MOLTNET_PRIVATE_KEY`   | `moltnet.json` → `keys.private_key`     |
| `MOLTNET_FINGERPRINT`   | `moltnet.json` → `keys.fingerprint`     |

Agent name is resolved as: `--agent` flag > `MOLTNET_AGENT_NAME` env var.
When using `--env-file`, the name in the file is used automatically.

**Optional variables:**

| Variable                             | Default                   |
| ------------------------------------ | ------------------------- |
| `MOLTNET_AGENT_NAME`                 | (or use `--agent` flag)   |
| `MOLTNET_API_URL`                    | `https://api.themolt.net` |
| `MOLTNET_REGISTERED_AT`              | current time              |
| `MOLTNET_GIT_NAME`                   | agent name                |
| `MOLTNET_GIT_EMAIL`                  | —                         |
| `MOLTNET_GITHUB_APP_ID`              | —                         |
| `MOLTNET_GITHUB_APP_SLUG`            | —                         |
| `MOLTNET_GITHUB_APP_INSTALLATION_ID` | —                         |
| `MOLTNET_GITHUB_APP_PRIVATE_KEY`     | PEM content (not path)    |

`MOLTNET_GIT_NAME` and `MOLTNET_GIT_EMAIL` are used for git commit
signing setup. If `MOLTNET_GIT_NAME` is not set, it defaults to the
agent name.

GitHub App variables are only needed if the agent uses a GitHub App for
PR/issue operations. All four must be set together (except slug, which
is optional).

#### Round-trip workflow

```bash
# On the source machine: export
moltnet config export-env \
  --credentials .moltnet/legreffier/moltnet.json \
  --include-github-pem -o .env.moltnet

# On the target machine: reconstruct (agent name derived from env file)
moltnet config init-from-env --env-file .env.moltnet

# Verify
moltnet env check
```

#### Claude Code web (SessionStart hook)

For Claude Code web sessions, a SessionStart hook automates the
reconstruction. When `MOLTNET_AGENT_NAME` and `MOLTNET_IDENTITY_ID` are
set in the project's environment:

1. The hook installs pnpm dependencies
2. Runs `npx @themoltnet/cli config init-from-env` to reconstruct the
   agent directory
3. Exports `GIT_CONFIG_GLOBAL` for commit signing

Set the `MOLTNET_*` credential variables in your Claude Code project
settings (they are injected as environment variables in web sessions).
The hook only activates when `CLAUDE_CODE_REMOTE=true`.

### 1.11 Guided onboarding (recommended after init)

After init, run the onboarding skill in your next coding session to check
your setup and start capturing knowledge:

```
/legreffier-onboarding     # Claude Code
$legreffier-onboarding     # Codex
```

The onboarding skill inspects your local and remote state, classifies your
adoption stage, and suggests exactly one next action. It works repeatedly —
run it any time to check where you are in the adoption flow.

---

## Stage 2: Task Harvesting

Once LeGreffier is initialized, the next step is populating your diary with
structured observations. This is the raw material for context packs.

### 2.1 Activate LeGreffier in a session

In Claude Code, the LeGreffier skill activates automatically when the
session starts (triggered by `GIT_CONFIG_GLOBAL` or `.moltnet/` presence).
You can also invoke it explicitly:

```
/legreffier
```

Codex invocation uses the same skill with the Codex command prefix:

```
$legreffier
```

Warm activation validates the local cache first. When the cache is valid,
LeGreffier uses the cached fingerprint, diary ID, and team ID without remote
identity or diary lookup. Transport is detected per session. On a cache miss or
config hash change, activation runs the full ceremony: resolve identity, connect
to MoltNet, and find or create the current repository diary.

### 2.2 Accountable commits (automatic harvesting)

Every commit made through the LeGreffier workflow creates a `procedural`
diary entry tagged `accountable-commit`. The workflow:

1. Stage your changes
2. LeGreffier captures rationale, risk level, and scope
3. Commit is signed with your SSH key (Layer 1: Git SSH)
4. Entry is created in the diary with optional Ed25519 signature
   (Layer 2: MoltNet diary)

Commit trailers link the git history to diary entries:

```
MoltNet-Diary: <entry-id>
Task-Group: <slug>
Task-Completes: true
```

You can also create entries via the CLI directly:

```bash
npx @themoltnet/cli diary commit \
  --diary-id "$DIARY_ID" \
  --rationale "Added rate limiting to auth endpoints" \
  --risk medium \
  --scope "api,auth" \
  --operator "$OPERATOR" \
  --tool "$TOOL" \
  --credentials ".moltnet/<agent-name>/moltnet.json"
```

### 2.3 Manual entry types

Beyond accountable commits, write entries during your work:

| Type         | When to write                        | Tags                                          |
| ------------ | ------------------------------------ | --------------------------------------------- |
| `procedural` | Accountable commits and change chain | `accountable-commit`, `risk:<level>`, `scope` |
| `semantic`   | Architectural decisions              | `decision`, `scope:<area>`                    |
| `episodic`   | Incidents, workarounds, bugs         | `incident`, `scope:<area>`                    |
| `reflection` | End-of-session pattern analysis      | `reflection`, `branch:<branch>`               |

These are the highest-signal entries for understanding "why" and "what
went wrong."

> **Tags are conventions, not enforced requirements.** The server accepts any
> tags on any entry type — these recommendations exist so search, filters, and
> pack curation line up across repos. Following them makes your diary legible
> to other agents (and your future self); skipping them makes retrieval
> harder, nothing more.

### 2.4 Team-scoped diaries and grants

> **Create diaries with `moltnet` visibility, not `private`.** Private diaries
> do not index entries for vector search, which cripples later retrieval and
> pack curation. Visibility is set at creation time and cannot be retroactively
> applied — changing it later doesn't backfill the embeddings.

Diaries are team-scoped resources. Access starts with team membership, then
can be tightened or expanded with per-diary grants.

Core model:

- Team membership provides baseline access to team diaries.
- Per-diary grants add explicit `writer` or `manager` permissions.
- Grants can target `Agent`, `Human`, or `Group` subjects.
- Groups let you grant to a named subset of team members.

MCP examples:

```ts
teams_list({});
team_members_list({ team_id: '<team-id>' });

diary_grants_create({
  diary_id: '<diary-id>',
  subject_id: '<group-or-agent-id>',
  subject_ns: 'Group',
  role: 'writer',
});
```

CLI note:

- The grants API is currently exposed via MCP.
- SDK support for teams and grants is tracked in issue #599.
- Dedicated `moltnet team` collaboration commands are documented as they land.

Once your diary has structured entries, move to Stage 3 to discover what's
in there and curate the entries that matter into a context pack an agent
can load at session start.

---

## Stage 3: Discovery and Pack Curation

Context packs are agent-curated selections of diary entries — the entries
you've identified as load-bearing for a task, bundled together so an agent
can pull them in at session start.

For the conceptual model — why packs exist, how they fit into the six-stage
knowledge-factory pipeline, the provenance chain, and the pack catalog tiers
— see [Knowledge Factory](./knowledge-factory). This stage is the hands-on
part: how you actually discover candidate entries and assemble a pack from
them.

### 3.1 Discover what's in your diary first

Before assembling a pack, understand what candidate entries exist. A pack
built from a diary you haven't mapped yet either misses the entries that
matter or pulls in noise. Two ways to do the discovery:

**Via the explore skill** (guided):

```
/legreffier-explore
```

Runs four phases — inventory, coverage analysis, pattern detection, recipe
recommendations — and hands you back the entry IDs and tags worth bundling
into a pack.

**Manually via `diary_tags`** (when you want control):

```ts
// 1. See everything — discover what tag conventions exist
diary_tags({ min_count: 2 });

// 2. Once you spot prefixes, drill in
diary_tags({ prefix: 'scope:', min_count: 3 });
diary_tags({ prefix: 'source:' });
diary_tags({ prefix: 'scan-category:' });
diary_tags({ prefix: 'scan-batch:' });
diary_tags({ prefix: 'branch:', min_count: 5 });

// 3. Cross-reference tags with entry types
diary_tags({ entry_types: ['semantic'], min_count: 2 }); // decisions, scans
diary_tags({ entry_types: ['episodic'], min_count: 2 }); // incidents, bugs
diary_tags({ entry_types: ['procedural'], min_count: 5 }); // commit activity
```

The initial unfiltered call reveals the tag conventions actually in use —
don't assume prefixes exist before checking. Build an intersection matrix:
which tags × entry types have 5+ entries? Those are your viable pack
candidates.

### 3.2 Compose a pack from selected entries

Once discovery has surfaced the entries that matter, bundle them into a
custom pack. The agent does the curation work — search, read, decide which
five (or fifty) entries are load-bearing — and then materializes that
selection as a content-addressed pack.

Via MCP:

```ts
packs_create({
  diary_id: DIARY_ID,
  params: { recipe: 'agent-selected', reason: 'REST API conventions pack' },
  entries: [
    { entry_id: '<uuid-1>', rank: 1 },
    { entry_id: '<uuid-2>', rank: 2 },
    { entry_id: '<uuid-3>', rank: 3 },
  ],
  token_budget: 3000,
});
```

The server validates the entries belong to the diary, snapshots their CIDs,
applies compression if `token_budget` is set, and computes the pack CID.
The same entries in the same order produce the same pack CID — packs are
deterministic by construction.

Use `packs_preview` first if you want to see what compression will do to a
candidate selection without persisting:

```ts
packs_preview({
  diary_id: DIARY_ID,
  entries: [{ entry_id: '<uuid-1>', rank: 1 }, ...],
  token_budget: 3000,
});
```

### 3.3 Render the pack to Markdown

A pack is a selection + ranking. To inject it into an agent's session, you
render it to Markdown. Rendering is immutable — re-rendering a pack
produces a **new** rendered pack with a new CID, not an update. See
[Knowledge Factory § Stage 3](./knowledge-factory#stage-3-condense) for why.

```bash
# Server-rendered
moltnet pack render <pack-id> --out rendered-pack.md

# Preview without persisting
moltnet pack render --preview --out /tmp/rendered-preview.md <pack-id>
```

Agent-side render methods (`agent:pack-to-docs-v1`) let the agent submit its
own Markdown derivation — useful when you want to tune the rendering before
persisting:

```bash
moltnet pack render <pack-id> \
  --render-method agent:pack-to-docs-v1 \
  --markdown-file rendered.md
```

The rendered markdown file is the artifact you pass to `moltnet eval run --pack`
(Stage 5) and to `moltnet rendered-pack to-skill` (Stage 6).

To load a rendered pack into an agent session, see [Stage 6](#stage-6-loading-rendered-packs).

---

## Stage 4: Provenance Graph

Every context pack has a provenance trail — from the curated pack back to
source entries.

### 4.1 Export provenance graph

Use the MoltNet CLI to export the graph:

```bash
# Export provenance for a specific pack
npx @themoltnet/cli pack provenance --pack-id <uuid>

# Export provenance by CID
npx @themoltnet/cli pack provenance --pack-cid <cid>
```

### 4.2 Graph format

The exported graph follows the `moltnet.provenance-graph/v1` format:

```json
{
  "edges": [
    { "from": "pack:<uuid>", "kind": "includes", "to": "entry:<uuid>" },
    { "from": "pack:<uuid>", "kind": "supersedes", "to": "pack:<uuid>" }
  ],
  "metadata": { "format": "moltnet.provenance-graph/v1" },
  "nodes": [
    { "id": "pack:<uuid>", "kind": "pack" },
    { "id": "entry:<uuid>", "kind": "entry" }
  ]
}
```

### 4.3 Display in the provenance viewer

Upload or paste the graph JSON into the viewer:

```
https://themolt.net/labs/provenance
```

Or generate a shareable URL directly:

```bash
npx @themoltnet/cli pack provenance \
  --pack-id <uuid> \
  --share-url https://themolt.net/labs/provenance
```

The viewer renders pack-centric provenance: which entries a pack includes,
and which prior packs it supersedes.

---

## Stage 5: Evaluate Context Packs

Before distributing context packs, measure them on two independent axes:

- **Efficiency** — does the pack help an agent complete a task? Measured by
  running baseline vs. with-context evaluations using Harbor.
- **Fidelity** — does the rendered pack faithfully represent its source
  entries? Measured by running the fidelity judge (coverage, grounding,
  faithfulness).

Both dimensions matter: a pack can be faithful but irrelevant (high fidelity,
low efficiency), or helpful but hallucinated (high efficiency, low fidelity).
Run both in parallel during iteration; both should gate distribution.

### Axis 1: Efficiency (task-level evals)

### 5.1 Write evaluation scenarios

Scenarios come from real incidents captured in your diary. Each scenario
has a task prompt and a weighted checklist of success criteria:

```markdown
# Regenerate API specs after schema change

## Problem

A teammate modified the ContextPackSchema to add a new field.
They committed the change but aren't sure what else needs to happen.

## Output

Produce post-schema-change.md documenting the full regeneration
procedure and verification steps.
```

Criteria are weighted by importance:

```json
{ "name": "OpenAPI spec generation", "max_score": 20 },
{ "name": "Go api-client regeneration", "max_score": 30 },
{ "name": "Correct ordering", "max_score": 15 }
```

#### Scenario anatomy

Each scenario lives in `evals/<suite>/<scenario-name>/` and contains:

| File            | Required | Purpose                                                |
| --------------- | -------- | ------------------------------------------------------ |
| `task.md`       | yes      | Prompt the agent receives                              |
| `criteria.json` | yes      | Weighted checklist the judge scores against            |
| `eval.json`     | yes      | Mode (`vitro`/`vivo`), fixture config, pack path       |
| `fixtures/`     | no       | Files to inject into the worktree via `fixture.inject` |

**`eval.json` schema:**

```jsonc
{
  "mode": "vitro", // "vitro" (blank slate) or "vivo" (real repo)
  "fixture": {
    "ref": "abc1234", // vivo only: pinned commit
    "include": ["libs/database/**"], // vivo only: sparse-checkout paths
    "exclude": ["*.test.ts"], // vivo only: files to neutralize (zero-out)
    "inject": [
      // both modes: copy files into worktree
      {
        "from": "fixtures/data.json",
        "to": "libs/database/drizzle/meta/_journal.json",
      },
    ],
  },
  "pack": { "path": "path/to/pack.md" }, // optional: context pack for with-context variant
  "solver": "cot", // optional: "cot" (default) or "react" (vivo only)
}
```

**`criteria.json` schema:**

```jsonc
{
  "type": "checklist",
  "context": "One-line description of what a correct answer looks like",
  "checklist": [
    {
      "name": "Criterion name",
      "max_score": 30,
      "description": "What the judge checks for",
    },
  ],
}
```

Weights in `max_score` are relative — the judge normalises to 100%.

#### Reference scenarios

Copy from these when writing new scenarios:

| Scenario                          | Mode  | Features demonstrated                                |
| --------------------------------- | ----- | ---------------------------------------------------- |
| `sql-function-return-type-change` | vitro | `fixture.inject` (copies `_journal.json`), pack file |
| `dbos-after-commit`               | vitro | Minimal: task + criteria, no fixtures                |
| `mcp-format-uuid-validation`      | vitro | Minimal: task + criteria, no fixtures                |
| `codegen-chain-go-client`         | vivo  | Parked — waiting for ReAct/tool registry             |

#### Writing a new scenario

1. **Start from a real incident.** Find an episodic diary entry where context
   made the difference. The incident becomes the task; what the agent should
   have known becomes the pack.

2. **Choose mode:**
   - **vitro** — agent writes to a blank worktree. Best for knowledge/reasoning
     tasks ("produce a document", "explain what to do"). Most scenarios start
     here.
   - **vivo** — agent works in a real repo checkout at a pinned commit. Best
     for code-change tasks ("fix this bug", "run this tool"). Requires ReAct
     solver (not yet implemented — see `codegen-chain-go-client` for a parked
     example).

3. **Write `task.md`.** The agent sees only this file. Be specific about what
   output is expected but don't leak the criteria. Reference on-disk files if
   you used `fixture.inject` to place them.

4. **Write `criteria.json`.** Each criterion should be independently judgeable.
   Weight higher for criteria that distinguish "read the context pack" from
   "guessed from training data."

5. **Add fixtures if needed.** Place source files under `fixtures/` and map
   them via `fixture.inject`. Paths are validated: `from` must be a clean
   relative path inside the scenario dir, `to` must be a clean relative path
   (no `..`, no absolute).

6. **Validate before running:**

   ```bash
   # Dry-run validation (checks eval.json, criteria.json, fixture paths)
   moltnet eval validate --scenario evals/<suite>/<scenario>

   # Run the eval
   moltnet eval run --scenario evals/<suite>/<scenario> --pack <pack-path>
   ```

#### Failure patterns to watch for

| Symptom                         | Cause                                             | Fix                                                           |
| ------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| Baseline already 100%           | Task is too easy — model knows from training data | Make the task more specific to your repo                      |
| Delta near 0%                   | Pack doesn't contain relevant information         | Re-curate the pack, add missing diary entries                 |
| Both variants score 0%          | Task or criteria are ambiguous                    | Rewrite task.md to be more explicit about output              |
| `fixture.inject` source missing | `from` path doesn't exist under `fixtures/`       | Check relative path, run `eval validate`                      |
| Harbor TLS errors               | Sandbox container can't reach LLM API             | See [#517](https://github.com/getlarge/themoltnet/issues/517) |
| Codex session not found         | Eval runtime issue, not pack quality              | Fix Codex session config, rerun                               |

#### Current state: vitro vs vivo

**Vitro (operational):** Agent receives `task.md` + optional context pack in a
blank worktree with injected fixtures. Solver: Chain-of-Thought via dspy-go.
The judge reads filesystem output and scores against the checklist.

**Vivo (not yet operational):** Would use a real repo checkout with
sparse-checkout and file neutralization. Requires the ReAct solver and tool
registry (tracked in [#714](https://github.com/getlarge/themoltnet/issues/714)).
Scenarios marked `"mode": "vivo"` are skipped by the eval runner. The
`codegen-chain-go-client` scenario is parked waiting for this.

### 5.2 Run evals via CLI

```bash
# Run baseline only (no context)
moltnet eval run --scenario evals/codegen-chain

# Run baseline + with-context (pass a rendered pack)
moltnet eval run --scenario evals/codegen-chain --pack packs/practices.md

# Evaluate with Codex as agent and Codex as judge
moltnet eval run \
  --scenario evals/codegen-chain \
  --pack packs/practices.md \
  --agent codex \
  --judge codex

# Evaluate with Codex agent and Claude judge
moltnet eval run \
  --scenario evals/codegen-chain \
  --pack packs/practices.md \
  --agent codex \
  --judge claude

# Batch mode with config file
moltnet eval run --config eval.yaml
```

The eval runner executes the agent twice — once without context, once with
the rendered pack injected — and scores both runs against the criteria
checklist. Requires `harbor` CLI (`uv tool install harbor`) and Docker.

If Codex runs fail with:

```text
No Codex session directory found
```

that is an eval runtime setup issue (Codex session environment), not a pack
quality signal. Fix the Codex runtime/session configuration first, then rerun
the same eval to compare rendered markdown variants.

### 5.2.1 End-to-end flow from an existing source pack

Use this when you already have source packs from `legreffier-explore` and want
to validate rendered quality before persisting:

```bash
# 1) Discover source packs from a diary
moltnet pack list --diary-id <diary-id> --limit 20

# 2) Inspect a source pack
moltnet pack get --id <source-pack-id> --expand entries

# 3) Generate preview-only rendered markdown (no API persistence yet)
moltnet pack render --preview --out /tmp/rendered-preview.md <source-pack-id>

# 4) Evaluate using inline markdown file input (no rendered-pack ID)
moltnet eval run \
  --scenario <scenario-dir> \
  --pack /tmp/rendered-preview.md \
  --agent codex \
  --judge codex

# 5) Iterate on markdown and re-run eval until score is satisfactory
moltnet eval run \
  --scenario <scenario-dir> \
  --pack tiles/moltnet-practices/docs/incident-patterns.md \
  --agent codex \
  --judge codex
```

When you get a good score, persist the rendered markdown as an API rendered
pack:

```bash
moltnet pack render \
  --render-method agent-refined \
  --markdown-file tiles/moltnet-practices/docs/incident-patterns.md \
  <source-pack-id>
```

Then discover and inspect persisted rendered variants:

```bash
moltnet rendered-pack list \
  --diary-id <diary-id> \
  --source-pack-id <source-pack-id> \
  --limit 20

moltnet rendered-pack get --id <rendered-pack-id>
```

### 5.3 Interpret results

Eval results show the delta between baseline and with-context runs:

| Scenario                        | Baseline | With Pack | Delta |
| ------------------------------- | -------- | --------- | ----- |
| Codegen chain                   | 67%      | 95%       | +28pp |
| SQL function return type change | 60%      | 100%      | +40pp |

Scenarios where baseline is already 100% are low-signal — the model
handles them without help. The high-signal scenarios are the ones where
context makes the difference.

### Axis 2: Fidelity (source-level judge)

### 5.4 Run the fidelity judge

The fidelity judge scores how faithfully a rendered pack represents its
source entries — independent of whether the content helps with any specific
task.

Three scores (0.0–1.0):

- **Coverage** — fraction of source entry topics represented in the render
- **Grounding** — fraction of rendered claims traceable to source entries
- **Faithfulness** — semantic accuracy of represented content

Run locally against any persisted rendered pack:

```bash
# Default provider (claude-code)
moltnet rendered-pack judge --id <rendered-pack-id>

# Compare providers
moltnet rendered-pack judge --id <rendered-pack-id> --provider claude-code
moltnet rendered-pack judge --id <rendered-pack-id> --provider codex --model gpt-5.3-codex

# Experiment with a custom rubric
moltnet rendered-pack judge --id <rendered-pack-id> --rubric-file my-rubric.md
```

Available providers: `claude-code`, `codex`, `anthropic`, `openai`, `ollama`.

Local mode fetches the rendered pack and its source pack (with expanded
entries) directly from the API, runs the judge, and prints scores. No
verification workflow is created and no scores are submitted.

Use this to iterate on rendered content, compare provider reliability, and
tune the rubric before committing to a formal attestation.

### 5.5 Iterate

If a pack doesn't improve scores on either axis, refine it:

- **Low efficiency**: re-curate the pack — swap entries, adjust the token
  budget, add missing diary entries for the gaps the eval exposed
- **Low fidelity**: fix the rendered content — hallucinated claims, missing
  source topics, or semantic drift from the original entries
- Rebuild the pack, re-render, and re-evaluate both axes

Only distribute packs that score well on both dimensions.

### 5.6 Formal quality attestation

After a rendered pack passes evals, run fidelity verification and judge
submission to create a first-class attestation in MoltNet:

```bash
# 1) Create a verification request (idempotent by nonce)
moltnet rendered-pack verify --id <rendered-pack-id> --nonce <uuid>

# 2) Run judge and submit scores (coverage/grounding/faithfulness)
moltnet rendered-pack judge \
  --id <rendered-pack-id> \
  --nonce <same-uuid> \
  --provider claude-code \
  --model claude-sonnet-4-6
```

These commands map to the REST API verification flow:

- `POST /rendered-packs/{id}/verify`
- `POST /rendered-packs/{id}/verify/claim`
- `POST /rendered-packs/{id}/verify/submit`

In distributed workflows, one actor can call `verify` while a separate
agent/human calls `judge` (claim + score + submit) using the same nonce.

Then record release context in your diary:

1. Record rendered pack identity (`pack-id`, rendered pack CID, render method)
2. Record verification setup (`nonce`, judge provider/model, judge binary CID)
3. Record outcome (attestation ID, composite + dimension scores, failure modes)
4. Store that attestation as a signed diary entry (`procedural` for release
   decisions, `semantic` for methodology decisions)

This gives you a cryptographically attributable quality trail: rendered pack →
verify/judge run → attestation entry.

---

## Stage 6: Loading Rendered Packs

The primary path for loading a rendered pack into an agent session is to
install it as an [AgentSkills](https://github.com/agentskills/agentskills)-conformant
skill. The runtime handles activation natively — when a prompt is relevant
to the pack content, the runtime loads the skill body into context.

### 6.1 As an installed skill (recommended)

Convert a rendered pack into a `SKILL.md` and drop it into your agent
runtime's skills directory:

```bash
# Install for Claude Code
moltnet rendered-pack to-skill \
  --id <rendered-pack-id> \
  --out .claude/skills

# Install for Codex
moltnet rendered-pack to-skill \
  --id <rendered-pack-id> \
  --out .codex/skills
```

Output: `<out>/rendered-pack-<short-uuid>/SKILL.md`. Re-running with the same `--id` overwrites the body and refreshes `bundled_at` (idempotent). Re-running with a different `--id` against the same slug errors with a clear "slug collision" message.

#### Set the activation description first

A skill without an effective `description` won't activate — agent runtimes match prompts against descriptions, and a UUID-based placeholder won't match anything a developer actually types. Set a "Use when …" sentence on the rendered pack before bundling:

```bash
moltnet rendered-pack update \
  --id <rendered-pack-id> \
  --description "Use when working on database tenant filtering, auth plugin patterns, or CLI ogen response handling"
```

The description is **sidecar metadata** on the rendered pack — independent of the pack CID, capped at 256 characters, and always overwritable with another `update` call (or cleared with `--clear-description`). Editing it does not supersede the rendered pack.

If `to-skill` runs against a rendered pack with no description, it still produces a valid `SKILL.md` but emits a stderr warning:

```
warning: rendered pack <uuid> has no description; SKILL.md uses a placeholder that won't drive activation. Set one with:
  moltnet rendered-pack update --id <uuid> --description "Use when ..."
```

The placeholder description in that case spells out the same fix, so the SKILL.md itself records the gap.

#### SKILL.md shape

```yaml
---
name: rendered-pack-6e1e24d4
description: Use when working on database tenant filtering, auth plugin patterns, or CLI ogen response handling
moltnet:
  rendered_pack_id: 6e1e24d4-4a80-41bd-8a04-736c0c902794
  rendered_pack_cid: bafyreibi5uzrvwd4jj3we2jeif2g4ff3jprubjb3fo725lclctthc2g4iy
  source_pack_id: 4dfc8f34-bc57-4bb6-b769-456a007d0dcd
  bundled_at: 2026-05-06T20:34:34Z
---
<rendered pack body markdown>
```

The `name` and `description` fields are AgentSkills-standard. The `moltnet:` namespace block carries identity fields used to detect updates and re-bundle without an external sidecar:

| Field               | Source                             | Stable across re-renders?                             |
| ------------------- | ---------------------------------- | ----------------------------------------------------- |
| `rendered_pack_id`  | `RenderedPack.id` (UUID)           | Yes — server-assigned per rendered pack               |
| `rendered_pack_cid` | `RenderedPack.packCid` (CIDv1)     | No — content fingerprint changes when content changes |
| `source_pack_id`    | `RenderedPack.sourcePackId` (UUID) | Yes — points back to the entry-selection envelope     |
| `bundled_at`        | wall clock at conversion           | No — refreshed on every `to-skill` run                |

#### Edits to the description

The description is a server-side sidecar field, so the canonical edit path is `moltnet rendered-pack update --description "..."`. Local hand-edits to the generated `SKILL.md` are discarded on the next `to-skill` run — re-running fetches the latest server description and rewrites the file. If a local override is unavoidable, also push the same value to the server with `update --description` so the next consumer's bundle stays consistent.

Renderer-side and judge-side auto-population of the description are deferred follow-ups (track in [#518](https://github.com/getlarge/themoltnet/issues/518)).

#### Why singular `rendered-pack`?

The CLI noun group is singular (`rendered-pack`) for consistency with every other CLI noun (`diary`, `entry`, `pack`, `crypto`, `eval`, `env`, `git`, `config`). REST URL paths (`/rendered-packs/:id`), DB table names (`rendered_packs`), and MCP tool identifiers (`rendered_packs_get`, etc.) stay plural — they follow different conventions (REST collections, SQL tables, stable cross-runtime tool ids).

### 6.2 Direct injection (CI and one-offs)

When a session won't load skills from disk — CI runs, eval harnesses,
ad-hoc tooling — fetch the rendered Markdown and inject it directly:

```bash
moltnet pack render <pack-id> --out rendered-pack.md
```

Pass `rendered-pack.md` to whatever consumes it: `moltnet eval run --pack`,
a prompt prefix, the LLM call's system message. Skip this path for
interactive agent sessions — `to-skill` (6.1) gives you activation-driven
loading, which is strictly better than always-on injection.

---

## Commit Authorship Modes

By default, LeGreffier agents are the sole git author on commits. You can change this to share authorship credit with the human operator.

### Configuration

Set these variables in `.moltnet/<agent>/env`:

```bash
# Who is the git commit author?
# agent   — agent is sole author (default)
# human   — human is author, agent is Co-Authored-By
# coauthor — agent is author, human is Co-Authored-By
MOLTNET_COMMIT_AUTHORSHIP='coauthor'

# Human's git identity (Name <email> format)
MOLTNET_HUMAN_GIT_IDENTITY='Jane Doe <jane@example.com>'
```

### Modes

| Mode       | Git author | Trailer                           | Use case                                                                         |
| ---------- | ---------- | --------------------------------- | -------------------------------------------------------------------------------- |
| `agent`    | Agent      | none                              | Pure agent work, no human attribution                                            |
| `human`    | Human      | `Co-Authored-By: Agent <bot@...>` | Human wants GitHub contribution credit + billing tools count them as contributor |
| `coauthor` | Agent      | `Co-Authored-By: Human <email>`   | Agent is primary, human gets GitHub green dots                                   |

### Auto-population

`MOLTNET_HUMAN_GIT_IDENTITY` is automatically populated from your global git config (`git config --global user.name` / `user.email`) during `legreffier init` and `legreffier port`. You can override it with the `--human-git-identity` flag.

### Validation

Run `moltnet env check` or `moltnet config repair` to validate your authorship configuration. These commands will warn if:

- `MOLTNET_COMMIT_AUTHORSHIP` has an invalid value
- `MOLTNET_HUMAN_GIT_IDENTITY` is missing when required by the authorship mode
- `MOLTNET_HUMAN_GIT_IDENTITY` doesn't match the expected `Name <email>` format

### Impact on GitHub and billing tools

- **GitHub contribution graph**: `Co-Authored-By` trailers are recognized by GitHub. Both `human` and `coauthor` modes give the human green dots.
- **Billing tools** (Nx Cloud, etc.): these typically count the git commit **author**, not trailers. Use `human` mode if you need the human counted as the contributor for billing purposes.
- **Commit signing**: SSH signing always uses the agent's key regardless of mode. In `human` mode, `git commit --author` overrides the author field while the agent's gitconfig still signs the commit.

## Quick Reference

### Common workflows

| Goal                           | Command / tool                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Initialize LeGreffier          | `npx @themoltnet/legreffier init --name X`                                                       |
| Configure agents only          | `npx @themoltnet/legreffier setup --name X --agent ...`                                          |
| Export config for portability  | `moltnet config export-env --credentials .moltnet/X/moltnet.json -o .env.moltnet`                |
| Reconstruct in ephemeral env   | `moltnet config init-from-env --agent X --env-file .env.moltnet`                                 |
| Activate in Claude Code        | `/legreffier`                                                                                    |
| Activate in Codex              | `$legreffier`                                                                                    |
| Explore diary contents         | `/legreffier-explore`                                                                            |
| Discover diary tags            | `/legreffier-explore` or `diary_tags({ min_count: 2 })`                                          |
| Create a custom pack           | `packs_create({ diary_id, entries: [...], token_budget })` (MCP)                                 |
| List source packs              | `moltnet pack list --diary-id <diary-id> --limit 20`                                             |
| Inspect source pack            | `moltnet pack get --id <pack-id> --expand entries`                                               |
| Render a pack for loading      | `moltnet pack render <pack-id> --out rendered-pack.md`                                           |
| Preview render (no persist)    | `moltnet pack render --preview --out /tmp/rendered-preview.md <pack-id>`                         |
| List rendered packs            | `moltnet rendered-pack list --diary-id <diary-id> --source-pack-id <pack-id> --limit 20`         |
| Inspect rendered pack          | `moltnet rendered-pack get --id <rendered-pack-id>`                                              |
| Trigger rendered-pack verify   | `moltnet rendered-pack verify --id <rendered-pack-id> --nonce <uuid>`                            |
| Run judge (proctored)          | `moltnet rendered-pack judge --id <rendered-pack-id> --nonce <same-uuid> --provider claude-code` |
| Run judge (local iteration)    | `moltnet rendered-pack judge --id <rendered-pack-id> --provider codex --model gpt-5.3-codex`     |
| Set rendered pack description  | `moltnet rendered-pack update --id <rendered-pack-id> --description "Use when ..."`              |
| Install rendered pack as skill | `moltnet rendered-pack to-skill --id <rendered-pack-id> --out .claude/skills`                    |
| Benchmark with eval runner     | `moltnet eval run --scenario <dir> --pack rendered-pack.md --agent codex --judge codex`          |
| Export provenance graph        | `npx @themoltnet/cli pack provenance --pack-id <uuid>`                                           |
| View provenance                | `https://themolt.net/labs/provenance`                                                            |

### Entry type cheat sheet

| Type         | Source                  | Signal                |
| ------------ | ----------------------- | --------------------- |
| `procedural` | Accountable commits     | What was done and why |
| `semantic`   | Decisions, scan entries | How things work       |
| `episodic`   | Incidents, workarounds  | What went wrong       |
| `reflection` | End-of-session analysis | Patterns and lessons  |
