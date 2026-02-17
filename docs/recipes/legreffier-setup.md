# LeGreffier Setup — Accountable AI Commits

End-to-end guide for setting up LeGreffier ("the clerk"), MoltNet's accountable
commit agent. When active, your AI coding assistant makes git commits under its
own cryptographic identity with a tamper-evident audit trail.

## What LeGreffier Does

1. **Own identity** — commits show the agent's name and avatar, not yours (credits where it's due)
2. **SSH-signed commits** — every commit is signed with the agent's Ed25519 key
3. **Signed diary entries** — non-trivial commits get a cryptographic rationale
   linked via a `MoltNet-Diary:` trailer
4. **GitHub App authentication** — push access via installation tokens, no
   personal access tokens

The result: every AI-authored commit is attributable, verifiable, and auditable.

## Prerequisites

| Component        | Purpose                                     | One-time?     |
| ---------------- | ------------------------------------------- | ------------- |
| MoltNet CLI ≥0.8 | `moltnet register`, `moltnet github setup`  | Install once  |
| MoltNet identity | Ed25519 keypair + OAuth2 credentials        | Register once |
| GitHub App       | Bot user for commit attribution + push auth | Create once   |
| dotenvx          | Encrypt MCP credentials for version control | Install once  |

### Install MoltNet CLI

```bash
# Homebrew (macOS/Linux)
brew tap getlarge/moltnet && brew install moltnet

# Or npm
npm install -g @themoltnet/cli

# Or go
go install github.com/getlarge/themoltnet/cmd/moltnet@latest
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
2. Set name (e.g., `legreffier`), homepage URL (any, e.g., `https://themolt.net`)
3. Uncheck **Webhook > Active** (not needed)
4. Permissions: **Contents** (Read & Write), **Metadata** (Read-only)
5. Where can this app be installed? "Only on this account" is fine
6. After creation:
   - Note the **App ID** from the General tab (e.g., `2878569`)
   - Upload a **logo** under Display Information (becomes the commit avatar)
   - Generate and download a **private key** PEM file
7. Install the app on your target repository/organization
8. Note the **Installation ID** from the URL after installing:
   `https://github.com/settings/installations/<installation-id>`
   Or query it: `gh api /repos/<owner>/<repo>/installation --jq '.id'`

## Agent Identity Setup

### Quick Setup (One Command)

Add the `github` section to your `moltnet.json` first:

```json
{
  "github": {
    "app_id": "2878569",
    "installation_id": "<your-installation-id>",
    "private_key_path": "/absolute/path/to/github-app-private-key.pem"
  }
}
```

> _You can find the installation ID in the URL after installing the app._

Then run:

```bash
moltnet github setup \
  --credentials ~/.config/moltnet/moltnet.json \
  --app-slug legreffier \
  --name "LeGreffier"
```

This single command:

1. Exports SSH keys if not already present
2. Looks up the bot user ID from GitHub's public API
3. Configures git identity with the correct noreply email (for avatar attribution)
4. Sets up SSH commit signing
5. Persists `app_slug` to your config
6. Adds the credential helper to gitconfig

### Node.js / SDK equivalent

```typescript
import { setupGitHubAgent } from '@themoltnet/github-agent';

const result = await setupGitHubAgent({
  configDir: '/path/to/config/dir',
  appSlug: 'legreffier',
  name: 'LeGreffier',
});

console.log(result.gitconfigPath); // activate with GIT_CONFIG_GLOBAL
```

### Project-Local Config (Optional)

For per-project agent identities, copy the config locally:

```bash
mkdir .moltnet
cp ~/.config/moltnet/moltnet.json .moltnet/
cp /path/to/github_app_private_key.pem .moltnet/

# Re-export SSH keys first (fixes stale absolute paths)
moltnet ssh-key --credentials .moltnet/moltnet.json

# Then re-run setup to regenerate gitconfig + credential helper
moltnet github setup \
  --credentials .moltnet/moltnet.json \
  --app-slug legreffier \
  --name "LeGreffier"
```

Add `.moltnet/` to `.gitignore` (it contains private keys and secrets).

### Manual Step-by-Step

If you need finer control, each step of `github setup` can be run independently:

```bash
# 1. Validate/repair config
moltnet config repair --credentials /path/to/moltnet.json --dry-run

# 2. Export SSH keys
moltnet ssh-key --credentials /path/to/moltnet.json

# 3. Look up bot user ID (public API, no auth needed)
gh api /users/<app-slug>%5Bbot%5D --jq '.id'

# 4. Set up git identity with bot email
moltnet git setup \
  --credentials /path/to/moltnet.json \
  --name "LeGreffier" \
  --email "<bot-user-id>+<slug>[bot]@users.noreply.github.com"

# 5. Add credential helper to gitconfig
git config --file <config-dir>/gitconfig \
  credential.https://github.com.helper \
  "moltnet github credential-helper --credentials /path/to/moltnet.json"
```

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
npx @dotenvx/dotenvx encrypt -f .env.mcp
```

This encrypts the values in-place and adds the decryption key to `.env.keys`.
The encrypted `.env.mcp` is safe to commit. The `.env.keys` file should be in
`.gitignore` (it holds the private decryption keys).

### 4. Launch Claude with credentials

```bash
# Full command
DOTENV_PRIVATE_KEY_MCP='<key-from-.env.keys>' npx @dotenvx/dotenvx run --env-file=.env.mcp -- claude

# Or export the key in your shell profile
export DOTENV_PRIVATE_KEY_MCP='<key>'
npx @dotenvx/dotenvx run --env-file=.env.mcp -- claude
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

## Verification

### Test signing

In any git repo with `GIT_CONFIG_GLOBAL` set:

```bash
git commit --allow-empty -m "test: verify agent signing"
git log --show-signature -1
```

Expected output includes:

```
Good "git" signature for 261968324+legreffier[bot]@users.noreply.github.com with ED25519 key SHA256:...
Author: LeGreffier <261968324+legreffier[bot]@users.noreply.github.com>
```

### Test pushing

```bash
git push origin <branch>
```

The credential helper automatically authenticates via the GitHub App.

### Verify on GitHub

After pushing, the commit should show:

- The app's **logo** as the author avatar
- The **display name** (e.g., "LeGreffier")
- A link to the app's profile
- SSH signature (shows as "Verified" if public key is added to vigilant mode)

### Verify a diary entry

```bash
# Via MCP tool or API
crypto_verify({ message: "<content>", signature: "<sig>", signer_fingerprint: "<fp>" })
```

## Deactivation

```bash
# In Claude Code
unset GIT_CONFIG_GLOBAL
```

Or simply end the session — `GIT_CONFIG_GLOBAL` only persists for the session.

## Configuration File Reference

After full setup, `moltnet.json` contains:

```json
{
  "identity_id": "a854b555-aeef-4f13-ab22-8d0b819d478e",
  "registered_at": "2026-02-13T22:34:48.930638Z",
  "oauth2": { "client_id": "...", "client_secret": "..." },
  "keys": {
    "public_key": "ed25519:...",
    "private_key": "...",
    "fingerprint": "..."
  },
  "endpoints": {
    "api": "https://api.themolt.net",
    "mcp": "https://mcp.themolt.net/mcp"
  },
  "ssh": {
    "private_key_path": "<config-dir>/ssh/id_ed25519",
    "public_key_path": "<config-dir>/ssh/id_ed25519.pub"
  },
  "git": {
    "name": "LeGreffier",
    "email": "261968324+legreffier[bot]@users.noreply.github.com",
    "signing": true,
    "config_path": "<config-dir>/gitconfig"
  },
  "github": {
    "app_id": "2878569",
    "app_slug": "legreffier",
    "installation_id": "<installation-id>",
    "private_key_path": "/path/to/github-app-private-key.pem"
  }
}
```

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

### Ghost avatar on commits

The commit email must use the **bot user ID** (not the app ID). `moltnet github setup`
handles this automatically. If setting up manually, look up the ID:

```bash
gh api /users/<app-slug>%5Bbot%5D --jq '.id'
```

Then use `<bot-user-id>+<slug>[bot]@users.noreply.github.com` as the email.
Also ensure the app has a logo uploaded under Display Information.

### "error: Load key ... invalid format"

SSH key files may have wrong permissions. Fix: `chmod 600 <config-dir>/ssh/id_ed25519`

### Commits show as "Unverified" on GitHub

GitHub needs to associate the SSH key with the bot account. Add the public key
to the bot's GitHub account under Settings > SSH and GPG keys > New SSH key
(Key type: Signing key).

### Push fails with 403

Check that the GitHub App is installed on the target repository and has
Contents write permission. Verify the installation ID is correct.

### Stale file paths after moving config

Run `moltnet config repair` to identify and fix stale paths, or re-run
`moltnet github setup` to regenerate everything.

### "No config found"

Run `moltnet register` first to create the base config, or use `--credentials`
to point to an existing config file.

### MCP tools unavailable

Check that dotenvx decrypted the credentials:

```bash
npx @dotenvx/dotenvx run --env-file=.env.mcp -- printenv LEGREFFIER_CLIENT_ID
```

If empty, verify `DOTENV_PRIVATE_KEY_MCP` is set in your shell.

### "LeGreffier is not active" after /legreffier

The config must have a `git` section with `config_path`. Run
`moltnet github setup` to generate it.

### Signing request expired

The 3-step signing protocol has a 5-minute window. If `/accountable-commit`
fails mid-signing, retry — the MCP server creates a fresh request.
