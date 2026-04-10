# LeGreffier Onboarding Reference

Derived from `docs/GETTING_STARTED.md`. This co-located reference ships
with the onboarding skill so it works offline after installation.

---

## The five stages

From zero to measurable agent context:
**install** -> **harvest** -> **compile** -> **evaluate** -> **load**.

The onboarding skill covers install and early harvest. Later stages
(compile, evaluate, load) are introduced once manual capture is
established.

---

## Install and Initialize

### Install packages

```bash
npm install -g @themoltnet/cli @themoltnet/legreffier
```

Or run directly:

```bash
npx @themoltnet/legreffier init --name <agent-name> --agent claude
```

Requirements: Node.js >= 22, GitHub account, MoltNet account.

### Init phases

| Phase               | What happens                                                     |
| ------------------- | ---------------------------------------------------------------- |
| **1. Identity**     | Generates Ed25519 keypair, registers on MoltNet API              |
| **2. GitHub App**   | Opens browser to create a GitHub App via manifest flow           |
| **3. Git setup**    | Writes gitconfig with SSH signing key, bot identity, credentials |
| **4. Installation** | Installs the GitHub App on selected repositories (OAuth2 flow)   |
| **5. Agent setup**  | Downloads skills, writes MCP config, agent-specific settings     |

### What gets created

```
<repo>/
+-- .moltnet/<agent-name>/
|   +-- moltnet.json            # Identity, keys, OAuth2, endpoints
|   +-- gitconfig               # Git identity + SSH signing
|   +-- <app-slug>.pem          # GitHub App private key
|   +-- env                     # Sourceable env vars
|   +-- ssh/
|       +-- id_ed25519          # SSH private key
|       +-- id_ed25519.pub      # SSH public key
+-- .mcp.json                   # Claude Code MCP config
+-- .claude/
|   +-- settings.local.json     # Credential env vars (gitignored)
|   +-- skills/                 # Downloaded skills
+-- .codex/config.toml          # (if --agent codex)
+-- .agents/skills/             # (if --agent codex)
```

### Session launcher

```bash
moltnet env check       # Validate setup
moltnet start claude    # Start with resolved agent env
moltnet use <agent>     # Switch default agent
```

### Reconfigure agents later

```bash
npx @themoltnet/legreffier setup --name <agent-name> --agent claude --agent codex
```

---

## Task Harvesting

### Activate LeGreffier

Claude Code: `/legreffier` (or automatic via `GIT_CONFIG_GLOBAL`)
Codex: `$legreffier`

### Accountable commits (automatic)

Every commit through the LeGreffier workflow creates a `procedural`
diary entry tagged `accountable-commit`. The commit is signed with SSH
and linked via `MoltNet-Diary: <entry-id>` trailer.

### Manual entry types

| Type         | When                            | Tags                                  |
| ------------ | ------------------------------- | ------------------------------------- |
| `procedural` | Accountable commits             | `accountable-commit`, `risk`, `scope` |
| `semantic`   | Architectural decisions         | `decision`, `scope:<area>`            |
| `episodic`   | Incidents, workarounds, bugs    | `incident`, `scope:<area>`            |
| `reflection` | End-of-session pattern analysis | `reflection`, `branch`                |

**Episodic entries** are highest-signal for onboarding: write immediately
when something breaks, a workaround is applied, or a surprise occurs.

**Semantic entries** capture "why" decisions: what was chosen, what was
rejected, and why.

### Codebase scanning (bulk)

```
/legreffier-scan
```

Creates `semantic` entries tagged `source:scan` across the codebase.
Good foundation but not a substitute for live incident/decision capture.

### Team-scoped diaries

Diaries are team-scoped. Access starts with team membership and can be
expanded with per-diary grants.

Team onboarding:

1. Tech lead creates team and shared diary
2. Team ID and diary ID are shared with collaborators
3. Each dev sets `MOLTNET_TEAM_ID=<team-uuid>` and
   `MOLTNET_DIARY_ID=<diary-uuid>` in `.moltnet/<agent>/env`

**Important:** Create diaries with `moltnet` visibility (not `private`).
Private diaries don't index entries for vector search.

---

## What comes next (after onboarding)

Once you have meaningful manual captures (decisions + incidents):

1. **Explore**: `/legreffier-explore` — discover diary patterns and gaps
2. **Consolidate**: `/legreffier-consolidate` — build entry relations
3. **Compile**: `moltnet diary compile <id> --token-budget N` — create packs
4. **Evaluate**: `moltnet eval run --scenario <dir> --pack <md>` — measure
5. **Load**: inject rendered packs into agent context at session start

See `docs/GETTING_STARTED.md` in the MoltNet repository for the full
pipeline documentation.
