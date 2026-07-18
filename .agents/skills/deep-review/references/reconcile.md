# deep-review prior-review reconciliation brief

Loaded by `/deep-review` at Phase 1.5 (`MODE=pr` only), launched **before** the verdict is known and collected
at Phase 1.6 — on `VERDICT ∈ {PIVOT, ASK}` the result is simply discarded. Goal: before deriving new
findings, check whether **already-raised, still-unresolved** review threads were actually fixed — so the
review doesn't re-report old issues as new, and genuine carry-over doesn't get lost. **Detection** is
**read-only** and runs **in an agent**; the writes under "Thread actions" run _only_ from Phase 5 with explicit
user approval, in the main agent. Either way, deep-review never **fixes the code** behind an open thread — that
stays `/fix-review`'s job.

## Sub-review config

Launch **one** sub-review at tier `standard` (resolve the tier to a concrete model/agent via your harness
adapter, `references/harness-*.md`) with the prompt below, **concurrently with the Phase 1.5 pre-flight
sub-review** — the two are independent and must run at the same time (sequentially only if the harness cannot
run sub-reviews concurrently). Fill the `{...}` placeholders from session state (`OWNER`, `REPO`, `PR_NUMBER`,
`REPO_ROOT`, `TREE_STATE`).

`{TREE_STATE}` is load-bearing — the sub-review cannot detect this itself and will otherwise classify with false
confidence against the wrong code:

- Normally → `at the PR head — trust it.`
- When `STALE_CONTEXT=1` (Phase 1 Step 0 fallback: `REPO_ROOT=cwd`, no tree at the PR head could be
  materialized) → `NOT at the PR head — it may be any revision, possibly dirty. You cannot verify whether a
thread was addressed. Mark every thread Ambiguous and say why.`

Why `standard` and not `highest`: classification is bounded comparison (does the code at `path:line` satisfy
the ask?), not open-ended bug-hunting. The security-critical upgrade in `specialists.md` does **not** apply
here — it keys off the diff's subject matter, not thread reconciliation — and every write is approval-gated
anyway.

The agent's entire return value is the compact thread list its prompt specifies under "Output". The GraphQL
payload and the code reads stay inside the agent; **none of it reaches the main context**.

```
Reconciling prior review threads on a PR. Read-only — do not edit code, do not post anything.

Owner: {OWNER}
Repo: {REPO}
PR: {PR_NUMBER}
Repo root: {REPO_ROOT}   <-- the review tree. Read code from HERE.
Tree state: {TREE_STATE}

## 1. Fetch unresolved threads

Run exactly this (the --jq filter is load-bearing — never fetch unprojected):

gh api graphql -f query='
  query($owner:String!,$repo:String!,$pr:Int!){
    repository(owner:$owner,name:$repo){
      pullRequest(number:$pr){
        reviewThreads(first:100){
          nodes{
            id isResolved isOutdated
            comments(first:20){ nodes{ databaseId author{login} body path line originalLine url } }
          }
        }
      }
    }
  }' -F owner={OWNER} -F repo={REPO} -F pr={PR_NUMBER} \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[]
        | select(.isResolved == false)
        | {id, isOutdated,
           path: .comments.nodes[0].path,
           line: (.comments.nodes[0].line // .comments.nodes[0].originalLine),
           url: .comments.nodes[0].url,
           firstCommentDatabaseId: .comments.nodes[0].databaseId,
           ask: .comments.nodes[0].body[:300],
           replies: [.comments.nodes[1:][].body[:150]]}'

Empty output = zero unresolved threads. Return exactly `Prior-review: none` and stop. Do nothing else.

## 2. Classify each thread

For each thread, read the code at `path:line` under {REPO_ROOT}. The code read is the source of truth —
but only as far as "Tree state" above allows: if it says the tree is NOT at the PR head, follow it.

| Status | Signal |
|---|---|
| Addressed | Code at `path` now satisfies the ask (often `isOutdated == true`). |
| Not addressed | Code unchanged, ask still valid (usually `isOutdated == false`). |
| Ambiguous | Can't tell from the code whether it was handled. |

`isOutdated` and `replies` are HINTS, never verdicts — a moved line reads as outdated without the concern
being fixed, an in-place fix can leave `isOutdated == false`, and a reply saying "fixed in abc123" is a
claim to check, not proof. Read the code before deciding.

Read only the lines around each thread's anchor. Do not read whole files, do not review the diff, do not
look for new issues — that is the specialists' job, not yours.

## 3. Output (strict, <=300 words, one line per thread, no preamble)

Prior-review: N unresolved — A addressed, B not addressed, C ambiguous.
- path:LINE | <status> | <ask, 1-line paraphrase> | <url> | <threadId> | <firstCommentDatabaseId>

If a thread's `ask` was null/empty, paraphrase as "(empty comment)". Findings only — no restating code,
no file summaries, no suggestions.
```

## Result → `PRIOR_THREADS`

The main agent stores the agent's returned lines as `PRIOR_THREADS`, one entry per unresolved thread:
`{ path, line, status, ask (1-line paraphrase), url, threadId, firstCommentDatabaseId }`
(`threadId` drives resolve; `firstCommentDatabaseId` — the first comment's `databaseId` — drives replies).
Surface the agent's `Prior-review: …` summary line to the user verbatim.

`Not addressed` entries flow into Phase 3 aggregation dedup and the Phase 4 **Carry-over** section. When any
`Not addressed` exist, suggest `/fix-review` to the user as the next step.

## Thread actions (Phase 5, approval-gated)

Detection above is read-only and agent-side. These are the **write** counterparts, run **only** from Phase 5
by the main agent, after the user approves the offer there. Same guardrails as `/fix-review`: never resolve a
thread you didn't verify, never spam replies. deep-review still does **not** fix the code behind an open
thread — that stays `/fix-review`.

**Resolve a verified-`Addressed` thread** (only the confirmed subset; uses the thread ID from `PRIOR_THREADS`):

```bash
gh api graphql -f query='
  mutation($id:ID!){
    resolveReviewThread(input:{threadId:$id}){ thread{ id isResolved } }
  }' -F id=$THREAD_ID
```

**Reply on a `Not addressed` thread** (`firstCommentDatabaseId` from `PRIOR_THREADS` — the REST replies
endpoint needs the first comment's numeric ID; only where it adds signal — a one-line "still open as of this
review — <why>", never "done"/"fixed"):

```bash
gh api repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments/$FIRST_COMMENT_DATABASE_ID/replies -f body='<reply>'
```

Never touch `Ambiguous` threads or any the user excluded. After acting, report which threads were resolved /
replied to, and which were left open and why.
