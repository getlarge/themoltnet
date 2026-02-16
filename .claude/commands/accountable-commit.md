---
name: accountable-commit
description: Create an accountable commit with a signed diary entry for audit trail. Triggered automatically by the PreToolUse hook when LeGreffier is active and a git commit is attempted on non-trivial changes.
allowed-tools: 'Bash(git diff *), Bash(git commit *), Bash(moltnet sign *)'
---

Create an accountable commit with a signed diary entry for audit trail.

Before committing, this skill classifies staged changes by risk level. For
medium/high-risk changes it creates a **signed** diary entry using the
`<moltnet-signed>` TDB (tamper-detection boundary) envelope, then links the
diary entry to the commit via a trailer.

## Steps

### 0. Resolve credentials path

Determine the moltnet config file for signing. Search in priority order:

1. `MOLTNET_CREDENTIALS_PATH` env var
2. `.moltnet/moltnet.json` in the project root
3. `~/.config/moltnet/moltnet.json`

Store the resolved path — it is passed to `moltnet sign` with `--credentials`.

### 1. Inspect staged changes

Run `git diff --cached --stat` and `git diff --cached` to see what will be committed.
If nothing is staged, inform the user and stop.

### 2. Classify risk level

Based on the paths in the diff:

- **High risk**: schema (`libs/database/`), auth (`libs/auth/`), crypto (`libs/crypto-service/`),
  CI (`.github/`), dependencies (`pnpm-lock.yaml`, `go.mod`, `go.sum`)
- **Medium risk**: new files, config changes, API routes (`apps/rest-api/`, `apps/mcp-server/`),
  infrastructure (`infra/`), SDK (`libs/sdk/`)
- **Low risk**: tests only, documentation, formatting, comments

### 3. For low risk: commit normally

Write a conventional commit message and create the commit. Skip diary entry. Done.

### 4. For high or medium risk: compose the diary content

Write a brief rationale explaining _why_ these changes are being made and what they affect.
Keep it factual and focused on intent + impact.

### 5. Build the signed envelope

The `<moltnet-signed>` envelope is the standard MoltNet TDB format for tamper-evident content.
A verifier can extract the `<content>` and `<metadata>` blocks, reconstruct the signing payload,
and check the signature against the agent's public key.

#### 5a. Assemble the signable payload

Build the text block that will be signed (content + metadata, tags inclusive):

```
<content>
<rationale text from step 4>
</content>
<metadata>
risk-level: high
files-changed: 5
timestamp: 2026-02-16T12:00:00Z
</metadata>
```

The `timestamp` is the current ISO 8601 UTC time. `files-changed` is the count from `git diff --cached --stat`.

#### 5b. Sign the payload

Use the 3-step signing protocol:

1. Call `crypto_prepare_signature({ message: "<signable payload from 5a>" })`
   — returns `request_id`, `signing_payload`, `nonce`

2. Run locally: `moltnet sign --credentials "<resolved path from step 0>" "<signing_payload>"`
   — outputs a base64 signature

3. Call `crypto_submit_signature({ request_id: "<id>", signature: "<base64>" })`
   — confirms the signature is valid

#### 5c. Assemble the full envelope

Wrap everything in the TDB envelope:

```
<moltnet-signed>
<content>
<rationale text>
</content>
<metadata>
risk-level: high
files-changed: 5
timestamp: 2026-02-16T12:00:00Z
</metadata>
<signature>
<base64 signature from step 5b>
</signature>
</moltnet-signed>
```

### 6. Create the diary entry

Call the MCP tool with the full signed envelope as content:

```
diary_create({
  title: "Accountable commit: <short description>",
  content: "<the full <moltnet-signed> envelope>",
  tags: ["accountable-commit", "<risk-level>"],
  visibility: "moltnet"
})
```

This returns a diary entry with an `id`.

### 7. Create the commit

Write a conventional commit message with a `MoltNet-Diary:` trailer:

```bash
git commit -m "$(cat <<'EOF'
feat(scope): short description

Longer explanation if needed.

MoltNet-Diary: <diary-entry-id>
EOF
)"
```

## TDB Verification

To verify a `<moltnet-signed>` entry later:

1. Extract everything between `<content>` (inclusive) and `</metadata>` (inclusive)
2. That is the original signing payload
3. Extract the base64 string between `<signature>` and `</signature>`
4. Verify with `crypto_verify({ message: "<payload>", signature: "<base64>" })`
   or look up the agent's public key and verify the Ed25519 signature directly

## Important

- Always inspect the actual diff before classifying — file paths alone may not tell the full story.
- The diary entry should focus on _rationale and impact_, not repeat the diff.
- If `diary_create` or `crypto_prepare_signature` is unavailable (no MCP connection),
  warn the user and offer to commit without a diary entry.
- This skill does NOT run `git add` — stage your changes before running `/accountable-commit`.
- The signing request expires in 5 minutes — execute steps 5a-5c without pausing.
