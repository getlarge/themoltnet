# Stage 3: Connected but only auto-harvesting

## Signals

Compute from `entries_list` response:

- `LAST_ENTRY_AT` = max `createdAt`
- `LAST_MANUAL_ENTRY_AT` = max `createdAt` filtered to non-`source:scan` semantic/episodic

Print: `<procedural-count> procedural entries. Last entry <N> days ago. No manual captures yet.`

**Refinement — "auto-only stalled":** If only procedural/scan entries
and `LAST_ENTRY_AT` > `STALE_MANUAL_DAYS`:

> Commit capture is running but the last entry was `<N>` days ago.
> If work has slowed here, that's fine; if not, check whether
> `/legreffier` is firing on commits.

## Detection

Resolve `DIARY_ID` from env or repo name match via `diaries_list`.

```
entries_list({ diary_id: DIARY_ID, limit: 50 })
```

Classify by `entryType`:

- `procedural` (auto-harvested commits)
- `semantic` NOT tagged `source:scan` (manual decisions)
- `episodic` (manual incidents)
- `reflection`

**Classification:**

- total == 0 → still Stage 2
- only procedural (+ `source:scan` semantics) → **Stage 3 — auto-only**
- exactly 1 manual semantic/episodic → **Stage 3 — transitional**
- 2+ manual semantic/episodic → **Stage 4**

## Actions (in order, one at a time)

Propose the first applicable action. After the user completes it, offer
to continue to the next (see step continuation in SKILL.md).

### 3a. First accountable commit (setup artifacts)

Check `git status` for uncommitted setup files: `.claude/skills/`,
`.agents/skills/`, `.mcp.json`, `.codex/config.toml`, `.gitignore`.

If found:

> You have uncommitted setup files from LeGreffier initialization:
>
> ```
> <git status --short filtered to setup files>
> ```
>
> Want to commit these? This will be your first accountable commit.

**Commit workflow (minimal for onboarding):**

1. Stage the setup files.
2. Create a procedural diary entry:
   ```bash
   $MOLTNET_CLI entry commit \
     --diary-id "$DIARY_ID" \
     --rationale "First accountable commit: LeGreffier setup artifacts (skills, MCP config, gitignore)." \
     --risk low \
     --scope "onboarding" \
     --operator "$OPERATOR" \
     --tool "$TOOL" \
     --credentials ".moltnet/<AGENT_NAME>/moltnet.json"
   ```
   Parse `entryId` from stdout JSON.
3. Commit with diary trailer:
   ```bash
   git commit -m "chore(onboarding): add LeGreffier setup artifacts" \
     -m "MoltNet-Diary: <entry-id>"
   ```
4. **Push and verify signature:**

   ```bash
   git push origin HEAD
   git verify-commit HEAD
   ```

   - Signature valid → `Commit pushed and signature verified.`
   - Signature NOT valid → warn:
     > The commit was pushed but its signature is **not verified**.
     > Check that `GIT_CONFIG_GLOBAL` points to
     > `.moltnet/<AGENT_NAME>/gitconfig` and that `gpg.format` and
     > `user.signingkey` are configured correctly.

If no setup files, skip to 3b.

### 3b. Identity entry

```
entries_list({ diary_id: DIARY_ID, tags: ["system", "identity"], limit: 1 })
```

If none:

> You don't have an identity entry in this diary yet. This anchors
> who you are for anyone reading this repo's history. Shall I create one?

Create via `identity_bootstrap` prompt or manually:
`entry_type: identity`, `tags: ["system", "identity"]`, `importance: 7`.
Content: agent name, fingerprint, public key, team, onboarding note.

If exists, skip to 3c.

### 3c. "Hello world" episodic entry

**Improvise the intro line** — creative, playful, unique. Reference
agent name, repo, and/or team naturally. No fixed templates.

```
<improvised intro>

Setup: <transport>, team "<team>", diary "<diary>"
Repository: <repo>
Onboarding stage: connected, first session

<metadata>
operator: <$USER> | tool: <tool> | timestamp: <ISO-UTC>
branch: <branch> | scope: onboarding | refs: .moltnet/<AGENT_NAME>/
</metadata>
```

`entry_type: episodic`, `tags: ["onboarding", "first-session", "branch:<branch>"]`,
`importance: 3`.

Present before creating. If `onboarding` tag already exists in diary, skip to 3d.

### 3d. Suggest captures from recent git history

```bash
git log --oneline -10
```

Heuristics:

- `refactor`, `migrate`, `redesign`, `rework` → semantic candidate
- `fix`, `hotfix`, `revert`, `workaround` → episodic candidate
- Large diffs (>200 lines) → worth capturing

Propose specifically if found. Skip silently if nothing interesting.

### Fallback

No actions available:

> Your commit capture flow is active — `<count>` procedural entries.
> Next time something breaks, `/legreffier` captures it as episodic.

Scan entries but no manual:

> You ran a codebase scan (`<count>` entries). Next step: capture
> live knowledge during real work sessions.
