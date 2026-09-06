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
> Run `moltnet agents init --name <agent-name>` to create a new agent
> identity, GitHub App integration, credentials, and git signing configuration.
>
> **Option B — Reuse an existing identity:**
> Identities are not per-repository any more; they live once per machine in
> `~/.config/moltnet/identities/<alias>/`. If one already exists, select it:
> `moltnet config identity select <alias>` (list them with
> `moltnet config identity list`).
> If you only have an old `.moltnet/<agent-name>/` bundle from another
> repository, import it once:
> `moltnet config migrate --credentials <source-repo>/.moltnet/<agent-name>/moltnet.json`
> The alias is taken from the path. The installed plugin supplies skills and
> hooks independently.

## Post-init: check `.gitignore`

Init and migrate both write to the central store, outside the repository, so
nothing new needs ignoring. Only check this when the repository still carries a
legacy `.moltnet/` bundle:

```bash
[ -d .moltnet ] && git check-ignore -q .moltnet/ 2>/dev/null
```

- **No `.moltnet/` directory**: nothing to do.
- **Exit 0**: already gitignored — skip.
- **Non-zero**: NOT gitignored. Warn and add `.moltnet/` to `.gitignore`
  (create the file if needed). This becomes part of the first accountable
  commit in Stage 3.

Stop here. Do not attempt API calls without credentials.

## Resolving `--credentials` for migrate

`moltnet config migrate --credentials` accepts a legacy repository bundle
(`<repo-root>/.moltnet/<agent-name>/moltnet.json`) or an agent-daemon document
(`<root>/agents/<alias>.json`). The alias is taken from the path in both cases.

1. Extract the path from the user's message.
2. Resolve to absolute:
   - Absolute → as-is
   - `~`-prefixed → expand `$HOME`
   - Relative → try `$HOME` first, then parent of current repo root
3. Propose the full command with the resolved absolute path.
4. If unresolvable, ask for an explicit absolute path.

Never fabricate paths, try fuzzy matching, or suggest `--from <repo-name>`.
