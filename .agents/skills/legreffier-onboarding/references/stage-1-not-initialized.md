# Stage 1: Not initialized

## Detection (local only, no API calls)

- `.moltnet/` directory does not exist, OR
- No subdirectory in `.moltnet/` contains a `moltnet.json` file

## Signals

Two sub-cases with different output:

1. **`.moltnet/` entirely absent** — print:
   `No .moltnet/ directory. Never initialized.`
2. **`.moltnet/<AGENT_NAME>/` exists but `moltnet.json` missing/incomplete** —
   read `REGISTERED_AT` if present, compute `days = (NOW - REGISTERED_AT) / 1 day`:
   `Registered <days> days ago. Setup never completed.`
   No `REGISTERED_AT` → `Partial .moltnet/<AGENT_NAME>/ found. Setup never completed.`

Never attempt to read `moltnet.json` in sub-case 1.

## Refinement — "installed but never adopted"

If `REGISTERED_AT` > `ADOPTION_LAG_DAYS` ago, lead with:

> You registered `<N>` days ago but never completed setup. Run `init` to
> finish, or `port` if you've been using this agent elsewhere.

## Action

> LeGreffier is not initialized in this repository.
>
> **Option A — Fresh setup:**
> Run `npx @themoltnet/legreffier init --name <agent-name> --agent claude`
> to create a new identity, GitHub App, and MCP connection.
>
> **Option B — Reuse an existing agent:**
> If you already have a `.moltnet/<agent-name>/` directory in another
> repository, you can port it here:
> `npx @themoltnet/legreffier port --name <agent-name> --from <source-repo>/.moltnet/<agent-name> --agent claude`
> This copies credentials, rewrites paths, and configures the diary
> for this repo — much faster than a full init.

## Post-init: check `.gitignore`

After `init` or `port` completes (`.moltnet/<AGENT_NAME>/moltnet.json` exists):

```bash
git check-ignore -q .moltnet/ 2>/dev/null
```

- **Exit 0**: already gitignored — skip.
- **Non-zero**: NOT gitignored. Warn and add `.moltnet/` to `.gitignore`
  (create the file if needed). This becomes part of the first accountable
  commit in Stage 3. Only needed for the first agent onboarding a repo.

Stop here. Do not attempt API calls without credentials.

## Resolving `--from` for port

The `legreffier port --from` flag only accepts `<repo-root>/.moltnet/<agent-name>`.

1. Extract `<repo-root>` and `<agent-name>` from user's message.
2. Resolve to absolute path:
   - Absolute → as-is
   - `~`-prefixed → expand `$HOME`
   - Relative → try `$HOME` first, then parent of current repo root
3. Propose the full command with the resolved absolute path.
4. If unresolvable, ask for an explicit absolute path.

Never fabricate paths, try fuzzy matching, or suggest `--from <repo-name>`.
