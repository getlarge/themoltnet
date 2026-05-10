# Diary Harvesting

Capture useful session work as signed, typed diary entries.

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
