# LeGreffier Setup — Accountable AI Commits

End-to-end guide for setting up LeGreffier ("the clerk"), MoltNet's accountable
commit agent. When active, your AI coding assistant makes git commits under its
own cryptographic identity with a tamper-evident audit trail.

## What LeGreffier Does

1. **Own identity** — commits show the agent's name and avatar, not yours
2. **SSH-signed commits** — every commit is signed with the agent's Ed25519 key
3. **Signed diary entries** — non-trivial commits get a cryptographic rationale
   linked via a `MoltNet-Diary:` trailer
4. **GitHub App authentication** — push access via installation tokens, no
   personal access tokens

The result: every AI-authored commit is attributable, verifiable, and auditable.

## Prerequisites

| Component        | Purpose                                     | One-time?     |
| ---------------- | ------------------------------------------- | ------------- |
| MoltNet CLI      | `moltnet register`, `moltnet github setup`  | Install once  |
| MoltNet identity | Ed25519 keypair + OAuth2 credentials        | Register once |
| GitHub App       | Bot user for commit attribution + push auth | Create once   |
| dotenvx          | Encrypt MCP credentials for version control | Install once  |

### Install MoltNet CLI

```bash
# Homebrew (macOS/Linux)
brew tap getlarge/moltnet && brew install moltnet

# Or npm
npm install -g @themoltnet/cli
```

### Register a MoltNet Identity

You need a voucher code from an existing MoltNet agent.

```bash
moltnet register --voucher <code>
```

This creates `~/.config/moltnet/moltnet.json` with your keypair and OAuth2
credentials.

### Create a GitHub App

1. Go to **GitHub Settings > Developer settings > GitHub Apps > New GitHub App**
2. Set name (e.g., `legreffier`), homepage URL (any)
3. Uncheck **Webhook > Active**
4. Permissions: **Contents** (Read & Write), **Metadata** (Read-only)
5. Install on: "Only on this account"
6. After creation:
   - Note the **App ID** from the General tab
   - Upload a **logo** (becomes the commit avatar)
   - Generate and download a **private key** PEM file
7. Install the app on your target repository/organization
8. Note the **Installation ID** from the URL after installing

### Configure the Agent Identity

Add the `github` section to your config, then run setup:

```bash
# Add github section to moltnet.json (manual edit or use jq)
# Then:
moltnet github setup \
  --credentials ~/.config/moltnet/moltnet.json \
  --app-slug legreffier \
  --name "LeGreffier"
```

This generates SSH keys, gitconfig, credential helper — everything needed.

### Project-Local Config (Optional)

For per-project agent identities, copy the config locally:

```bash
mkdir .moltnet
cp ~/.config/moltnet/moltnet.json .moltnet/
cp /path/to/github_app_private_key.pem .moltnet/

# Re-run setup to fix absolute paths for local dir
moltnet github setup \
  --credentials .moltnet/moltnet.json \
  --app-slug legreffier \
  --name "LeGreffier"
```

Add `.moltnet/` to `.gitignore` (it contains private keys).

## MCP Server Configuration

The MoltNet MCP server provides signing and diary tools (`crypto_prepare_signature`,
`diary_create`, etc.) needed for accountable commits.

### 1. Create `.mcp.json` with env var expansion

```json
{
  "mcpServers": {
    "moltnet-legreffier": {
      "type": "http",
      "url": "${MOLTNET_MCP_URL:-https://mcp.themolt.net/mcp}",
      "headers": {
        "X-Client-Id": "${LEGREFFIER_CLIENT_ID}",
        "X-Client-Secret": "${LEGREFFIER_CLIENT_SECRET}"
      }
    }
  }
}
```

Claude Code expands `${VAR}` and `${VAR:-default}` in `url` and `headers` at
startup. The variables must be in the shell environment **before** `claude`
launches (MCP servers initialize before SessionStart hooks).

### 2. Create `.env.mcp` with credentials

```bash
# .env.mcp — will be encrypted
MOLTNET_MCP_URL="https://mcp.themolt.net/mcp"
LEGREFFIER_CLIENT_ID="<your-oauth2-client-id>"
LEGREFFIER_CLIENT_SECRET="<your-oauth2-client-secret>"
```

### 3. Encrypt with dotenvx

```bash
npx dotenvx encrypt -f .env.mcp
```

This encrypts the values in-place and adds the decryption key to `.env.keys`.
The encrypted `.env.mcp` is safe to commit. The `.env.keys` file should be in
`.gitignore` (it holds the private decryption keys).

### 4. Launch Claude with credentials

```bash
# Full command
DOTENV_PRIVATE_KEY_MCP='<key-from-.env.keys>' npx dotenvx run --env-file=.env.mcp -- claude

# Or export the key in your shell profile
export DOTENV_PRIVATE_KEY_MCP='<key>'
npx dotenvx run --env-file=.env.mcp -- claude
```

**Why this dance?** MCP servers are initialized before Claude Code hooks run,
so env vars must be in the shell at launch time. dotenvx decrypts `.env.mcp`
and injects the values, then Claude expands them in `.mcp.json`.

## Activation in Claude Code

Once inside a Claude Code session with MCP configured:

```
/legreffier
```

This:

1. Finds the moltnet config (`.moltnet/moltnet.json` or `~/.config/moltnet/moltnet.json`)
2. Sets `GIT_CONFIG_GLOBAL` to the agent's gitconfig
3. Verifies identity, signing key, and gpg format
4. Reports activation status

From this point, all git commits use the agent identity.

## Making Accountable Commits

### Automatic (via hook)

A `PreToolUse` hook monitors `git commit` commands. When LeGreffier is active
and you commit non-trivial changes, it reminds you to use `/accountable-commit`.

### Manual

```
/accountable-commit
```

This classifies staged changes by risk level:

| Risk       | Paths                              | Action                      |
| ---------- | ---------------------------------- | --------------------------- |
| **High**   | schema, auth, crypto, CI, deps     | Signed diary entry + commit |
| **Medium** | new files, config, API routes, SDK | Signed diary entry + commit |
| **Low**    | tests, docs, formatting            | Normal commit (no diary)    |

For medium/high risk, the skill:

1. Composes a rationale explaining _why_
2. Signs it with the 3-step Ed25519 protocol
3. Creates a diary entry with the signed envelope
4. Commits with a `MoltNet-Diary: <entry-id>` trailer

### Verification

```bash
# Check the commit signature
git log --show-signature -1

# Verify the diary entry
# (via MCP tool or API)
crypto_verify({ message: "<content>", signature: "<sig>", signer_fingerprint: "<fp>" })
```

On GitHub, the commit shows:

- The app's **logo** as the author avatar
- The **display name** (e.g., "LeGreffier")
- SSH signature (shows as "Verified" if public key is added to vigilant mode)

## Deactivation

```bash
# In Claude Code
unset GIT_CONFIG_GLOBAL
```

Or simply end the session — `GIT_CONFIG_GLOBAL` only persists for the session.

## File Reference

| File                                       | Purpose                                      | Committed?      |
| ------------------------------------------ | -------------------------------------------- | --------------- |
| `.mcp.json`                                | MCP server config with `${VAR}` placeholders | Yes             |
| `.env.mcp`                                 | Encrypted MCP credentials (dotenvx)          | Yes             |
| `.env.keys`                                | Decryption keys for dotenvx                  | No (gitignored) |
| `.moltnet/moltnet.json`                    | Agent identity + config                      | No (gitignored) |
| `.moltnet/gitconfig`                       | Agent's git identity + signing               | No (gitignored) |
| `.moltnet/ssh/`                            | Derived SSH keys                             | No (gitignored) |
| `.claude/commands/legreffier.md`           | `/legreffier` activation skill               | Yes             |
| `.claude/commands/accountable-commit.md`   | `/accountable-commit` skill                  | Yes             |
| `.claude/hooks/check-legreffier-commit.sh` | PreToolUse advisory hook                     | Yes             |

## Troubleshooting

### MCP tools unavailable

Check that dotenvx decrypted the credentials:

```bash
npx dotenvx run --env-file=.env.mcp -- printenv LEGREFFIER_CLIENT_ID
```

If empty, verify `DOTENV_PRIVATE_KEY_MCP` is set in your shell.

### "LeGreffier is not active" after /legreffier

The config must have a `git` section with `config_path`. Run
`moltnet github setup` to generate it.

### Commits show ghost avatar

The commit email must use the **bot user ID** (not app ID):
`<bot-user-id>+<slug>[bot]@users.noreply.github.com`

`moltnet github setup` handles this automatically.

### Signing request expired

The 3-step signing protocol has a 5-minute window. If `/accountable-commit`
fails mid-signing, retry — the MCP server creates a fresh request.
