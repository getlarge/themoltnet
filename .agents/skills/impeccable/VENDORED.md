# Vendored: impeccable

Third-party frontend-design skill, vendored into this repo (committed real files,
not the `.agents`-source-of-truth + `.claude`-symlink convention used by
first-party skills).

- **Source:** https://github.com/pbakaus/impeccable
- **License:** Apache-2.0 (see `LICENSE`, `NOTICE.md` in this directory)
- **Installed version:** 4.0.2
- **Install method:** `npx impeccable@latest install` (providers: `claude-code`, `agents`; hook declined)

## Why this is an exception

impeccable ships **provider-specific builds** — the `.claude/skills/impeccable`
and `.agents/skills/impeccable` trees differ (command prefix `/` vs `$`,
per-provider reference docs; the `agents` build additionally ships `agents/`
subagents). A single symlinked source would give one harness the wrong
provider build, so both trees are committed as real files.

Because `.claude/skills/impeccable` is a real dir (not a symlink) and the
upstream `SKILL.md` frontmatter carries a non-spec top-level `version:` field,
impeccable is **explicitly excluded** from two CI gates. Keep these in sync:

- `.github/scripts/check-skill-sync.sh` — skips `impeccable` in the
  `.claude/skills` symlink check.
- `.github/workflows/ci.yml` (`skill-check` job) — excludes `impeccable` from
  the `skills-ref validate` fan-out.

## Updating

```bash
# From the repo root, scoped to the same providers, hook declined:
npx impeccable@latest update        # or: install, then pick claude + codex/agents only
```

Then:
1. `git diff` the two trees and **review** what changed (upstream pulls latest).
2. Re-copy `LICENSE`/`NOTICE.md` if the update removed them.
3. Re-run the local verification (both CI gates) — see the plan / commit history.
4. Update the "Installed version" above and commit via the legreffier flow.
