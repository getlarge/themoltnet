# Documentation Maintenance Strategy

This document outlines how to keep MoltNet documentation current and accurate.

## The Problem

Documentation drifts from reality because:

1. Code changes, docs don't
2. No forcing function to update docs
3. Unclear ownership of doc sections
4. No automated validation

## The Solution: Multi-Layered Enforcement

### Layer 1: Builder Journal as Single Source of Truth

**Rule**: The journal is mandatory. CLAUDE.md and other docs are optional derivations.

Every agent session must write journal entries. The journal becomes the canonical record of:

- What changed
- Why it changed
- What's next

CLAUDE.md and other docs are **summaries** extracted from the journal.

**Enforcement**: CI job `journal-check` fails PRs from `claude/` branches without a handoff entry.

### Layer 2: Periodic Doc Sync from Journal

**Monthly task** (add to project board):

```markdown
## Sync CLAUDE.md with journal entries

- Read last month of journal entries
- Identify stale sections in CLAUDE.md
- Update CLAUDE.md to reflect current state
- Update INFRASTRUCTURE.md, DESIGN_SYSTEM.md as needed
```

**Automation opportunity**: A script could parse journal entries and flag outdated CLAUDE.md sections:

```bash
# Future: scripts/check-doc-drift.sh
# Parse journal, compare to CLAUDE.md, flag discrepancies
```

### Layer 3: CI Validation of Factual Claims

**Add CI checks** for verifiable facts:

```yaml
# .github/workflows/doc-validation.yml
- name: Validate test counts
  run: |
    # Don't check exact counts — they drift
    # Just verify tests exist for claimed packages
    pnpm test 2>&1 | grep -q "libs/observability" || exit 1
    pnpm test 2>&1 | grep -q "apps/landing" || exit 1

- name: Validate commands exist
  run: |
    # Verify all commands in CLAUDE.md are in package.json
    grep "pnpm run" CLAUDE.md | grep -o "pnpm run [a-z:]*" | while read cmd; do
      cmd_name=$(echo $cmd | cut -d' ' -f3)
      grep -q "\"$cmd_name\":" package.json || {
        echo "CLAUDE.md references non-existent command: $cmd_name"
        exit 1
      }
    done

- name: Validate file structure
  run: |
    # Verify all packages mentioned in CLAUDE.md exist
    test -d apps/landing || exit 1
    test -d apps/mcp-server || exit 1
    test -d libs/observability || exit 1
```

### Layer 4: Ownership Table

Map doc sections to responsible workstreams:

| Doc Section                      | Owned By        | Update Trigger                    |
| -------------------------------- | --------------- | --------------------------------- |
| CLAUDE.md → Quick Start          | All agents      | New command added to package.json |
| CLAUDE.md → Repository Structure | All agents      | New workspace created             |
| CLAUDE.md → Workstream Status    | All agents      | Workstream milestone completed    |
| INFRASTRUCTURE.md → Ory/Supabase | WS1/WS2 agents  | Infra config changed              |
| INFRASTRUCTURE.md → Env Vars     | WS1 agents      | New env var added                 |
| DESIGN_SYSTEM.md                 | WS7 agents (UI) | Design system component added     |
| SANDBOX.md                       | All agents      | New sandbox issue discovered      |

**Rule**: If you change the code in a workstream, check if the owned doc section needs updating.

### Layer 5: Pull Request Template Checklist

Add to `.github/pull_request_template.md`:

```markdown
## Documentation Checklist

- [ ] If I added a new command, I updated `CLAUDE.md` Quick Start section
- [ ] If I added a new workspace, I updated `CLAUDE.md` Repository Structure
- [ ] If I changed Ory/Supabase config, I updated `INFRASTRUCTURE.md`
- [ ] If I added an env var, I updated `INFRASTRUCTURE.md`
- [ ] If I changed the design system, I updated `DESIGN_SYSTEM.md`
- [ ] If I completed a workstream milestone, I updated `CLAUDE.md` Workstream Status
- [ ] I wrote a journal entry documenting this work
```

### Layer 6: Quarterly Audit

**Quarterly task** (add to calendar):

```markdown
## Q1 2026 Documentation Audit

- Run `/claude-md-improver` to evaluate all docs
- Compare CLAUDE.md to actual codebase state
- Update stale sections
- Archive outdated docs
```

## What NOT to Include in Docs

To reduce maintenance burden:

1. **No test counts** — they drift immediately
2. **No commit hashes** — use "recent" or dates instead
3. **No version numbers** — unless critical for compatibility
4. **No implementation details** — link to code instead
5. **No duplicate info** — one canonical location per fact

## What MUST Be in Docs

1. **Commands** — every runnable script
2. **Structure** — high-level architecture
3. **Non-obvious patterns** — things you can't grep for
4. **Setup steps** — what a new contributor needs
5. **Reading order** — where to start

## Automation Roadmap

**Phase 1** (now):

- Builder journal enforcement (✅ done)
- PR template checklist

**Phase 2** (when painful):

- CI validation of commands/structure
- Script to flag stale sections

**Phase 3** (future):

- Auto-generate CLAUDE.md sections from journal
- Semantic diff between docs and code

## Key Insight

**The journal is cheap to write and hard to forget** (CI enforces it).

**CLAUDE.md is expensive to maintain** (no enforcement).

**Solution**: Make CLAUDE.md a summary view of the journal, not an independent artifact.
