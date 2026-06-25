# deep-review GitHub submission protocol

Loaded by `/deep-review` at Phase 5 when the user approves submitting to GitHub. Single atomic call; payload shape depends on `VERDICT`.

## Authorship guard

Before any GitHub write (`gh pr ...`, write-capable `gh api ...`, review
submission, or marker-only review), check whether the session is activated as a
MoltNet agent:

```bash
CFG="$GIT_CONFIG_GLOBAL"
case "$CFG" in /*) ;; *) CFG="$(git rev-parse --show-toplevel)/$CFG" ;; esac
case "$CFG" in
  */.moltnet/*/gitconfig)
    CREDS="$(dirname "$CFG")/moltnet.json"
    [ -f "$CREDS" ] || { echo "FATAL: moltnet.json not found at $CREDS" >&2; exit 1; }
    GH_TOKEN="$(moltnet github token --credentials "$CREDS")" || exit 1
    export GH_TOKEN
    ;;
esac
```

If token minting fails, stop. Do not let `gh` fall back to a human login unless
the user explicitly asked for visible human authorship on that specific GitHub
write. This keeps agent-authored reviews and marker comments attributed to the
activated agent.

## Single atomic call

```bash
gh api --method POST repos/$OWNER/$REPO/pulls/$PR_NUMBER/reviews --input - <<'JSON'
{
  "event": "COMMENT",
  "body": "<top-level body — see below>",
  "comments": [ /* line-anchored findings (PROCEED only; empty on PIVOT) */ ]
}
JSON
```

## Comment entry shape

```json
{
  "path": "<file>",
  "line": <RIGHT-side line>,
  "side": "RIGHT",
  "body": "**[Severity] · <Dimension>**\n\n<problem>\n\n**Why:** <impact>\n\n**Fix:** <direction>"
}
```

## Top-level body content

| VERDICT | Body |
|---|---|
| `PROCEED` | `<summary: verdict, top 3 risks, strengths, themes, coverage>\n\n<!-- deep-review:v1 approach-validated -->` (marker at end) |
| `PIVOT` | `<full pivot report from Phase 1.5: what the PR accomplishes, why the approach is problematic, alternatives with tradeoffs, recommended next step>` (**no marker** — next run re-evaluates after rework) |

## Rules

- `event: COMMENT` by default. `REQUEST_CHANGES` only on explicit user ask. Never `APPROVE`.
- Line comments must point to a line that exists **in the PR diff**. Findings outside the diff → move to top-level `body`, don't put in `comments[]` (the API rejects them).
- Multi-line range: `start_line` + `start_side` + `line` + `side`.
- Deleted-side comment: `"side": "LEFT"`.
- "Pick which findings" → show numbered list, submit only the chosen subset. Applies on `PROCEED` only; `PIVOT` is holistic.
- After submission, report the review URL and the comment count.

## Marker-only review (PR, own-work fix flow, no line review submitted)

When Branch A fixes findings locally without submitting a review, still mark the approach as validated so the next run skips the pre-flight:

```bash
gh api --method POST repos/$OWNER/$REPO/pulls/$PR_NUMBER/reviews \
  -f event=COMMENT \
  -f body='<!-- deep-review:v1 approach-validated -->'
```

Only post this when the user actually acted on findings (not after "no" to the fix offer, and not on `VERDICT=PIVOT` or `ASK`).
