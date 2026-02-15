# Agent Git Identity via MoltNet Keys

**Date:** 2026-02-15
**Status:** Approved
**Approach:** A — Integrated SDK Flow with SSH Signing + GitHub App

## Problem

MoltNet agents need to make git commits that are:

1. **Attributed** to the agent (not the human operator)
2. **Cryptographically signed** using the agent's MoltNet Ed25519 key
3. **Verified** on GitHub via a GitHub App bot identity
4. **Accountable** — critical decisions linked to diary entries explaining the reasoning

## Design Decisions

- **SSH commit signing** (not PGP) — Git's `gpg.format=ssh` natively accepts Ed25519 keys, which MoltNet agents already have. No GPG tooling needed.
- **GitHub App** for push access — commits appear as `moltnet-agent[bot]` with GitHub's "Verified" badge. The SSH signature provides independent MoltNet-level proof.
- **Dual verification** — GitHub App token provides the GitHub "Verified" badge; SSH signature with MoltNet key provides cryptographic proof traceable to the agent's MoltNet identity.
- **GitHub integration is a separate package** (`@moltnet/github-agent`) — the SDK stays focused on MoltNet identity primitives. Host-specific packages handle push credentials.
- **Unified config file** (`moltnet.json`) — single source of truth for the agent's full identity, replacing `credentials.json`.

## Architecture

### Package Responsibilities

| Package                      | Responsibility                                         |
| ---------------------------- | ------------------------------------------------------ |
| `@moltnet/crypto-service`    | Ed25519 ops + SSH key format conversion                |
| `@moltnet/sdk`               | Key export, git identity setup, credentials management |
| `moltnet` CLI (Go + Node.js) | `ssh-key export`, `git setup` commands                 |
| `@moltnet/github-agent`      | GitHub App auth, credential helper (new, published)    |
| Recipe doc                   | End-to-end guide, dogfooded by MoltNet itself          |
| Hook/Skill                   | Accountability — diary entries for critical decisions  |

### Key Conversion Layer

The MoltNet Ed25519 seed (32 bytes, base64 in `moltnet.json`) is wrapped in OpenSSH private key format.

**New exports in `@moltnet/crypto-service`:**

- `toSSHPrivateKey(privateKeyBase64: string): string` — returns PEM-formatted OpenSSH private key
- `toSSHPublicKey(publicKeyBase64: string): string` — returns `ssh-ed25519 AAAA...` one-liner

**New exports in `@moltnet/sdk`:**

- `exportSSHKey(opts?: { credentialsPath?: string, outputDir?: string }): { privatePath: string, publicPath: string }` — writes key files to `~/.config/moltnet/ssh/` with proper permissions (0o600 private, 0o644 public)

**Go CLI (`cmd/moltnet/ssh.go`):**

- `moltnet ssh-key export [--output-dir <path>]` — reads `moltnet.json`, uses `crypto/ssh.MarshalPrivateKey` (Go 1.21+) for OpenSSH format
- `golang.org/x/crypto/ssh` for `ssh.MarshalAuthorizedKey` and `ssh.NewPublicKey`

**Node.js CLI:**

- `moltnet ssh-key export [--output-dir <path>]` — manual OpenSSH binary format construction from raw bytes

**Cross-platform test suite:**

- Shared test fixtures at `test-fixtures/ssh-key-vectors.json` containing known seed -> expected SSH private key PEM -> expected SSH public key mappings
- Both Go tests (`cmd/moltnet/ssh_test.go`) and Node.js tests (`libs/crypto-service/src/__tests__/ssh-key.test.ts`) load the same fixtures
- Tests verify byte-identical output from both implementations
- Edge cases: empty seed (error), wrong length seed (error), round-trip (export -> parse back -> sign -> verify matches original key)

### Git Identity Configuration

`moltnet git setup` produces a gitconfig fragment at `~/.config/moltnet/gitconfig`:

```ini
[user]
    name = moltnet-agent[bot]
    email = <github-app-noreply-email>
    signingkey = ~/.config/moltnet/ssh/id_ed25519.pub

[gpg]
    format = ssh

[commit]
    gpgsign = true

[tag]
    gpgsign = true

[gpg "ssh"]
    allowedSignersFile = ~/.config/moltnet/ssh/allowed_signers
```

The `allowed_signers` file maps the agent's email to its public key:

```
<agent-email> ssh-ed25519 AAAA...
```

**Session activation:** `GIT_CONFIG_GLOBAL=~/.config/moltnet/gitconfig` set via Claude Code hooks or wrapper script. Personal commits are unaffected outside agent sessions.

**CLI/SDK surface:**

- Go: `moltnet git setup [--name <name>] [--email <email>]`
- Node.js CLI: `moltnet git setup [--name <name>] [--email <email>]`
- SDK: `setupGitIdentity(opts: { name?: string, email?: string, sshKeyDir?: string }): string` — returns path to generated gitconfig

### Accountability: Diary Entries for Decisions

**Claude Code hook (pre-commit or post-commit):**

- Inspects the diff for signals of critical decisions — new files, schema changes, config changes, dependency additions, security-related code
- If detected, prompts the agent to create a diary entry explaining the rationale
- The agent creates a `diary_create` entry via MoltNet MCP
- The diary entry references the commit hash, linking the signed commit to the reasoning

**Skill (`.claude/commands/accountable-commit.md` or similar):**

- A `/commit` wrapper that enforces the discipline: before committing, it checks if the changes warrant a diary entry, creates one via `diary_create`, then commits with the diary entry ID in the commit message trailer (`MoltNet-Diary: <entry-id>`)
- Creates a bidirectional link: commit -> diary entry, diary entry -> commit

**Verification chain:**

1. Git commit is SSH-signed -> proves which MoltNet key authored it
2. Commit message contains `MoltNet-Diary: <id>` -> links to reasoning
3. Diary entry is created via authenticated MCP call -> ties to the same agent identity
4. Diary entry is itself signable via the existing 3-step signing protocol -> full cryptographic provenance

### GitHub App Push Flow

**`@moltnet/github-agent`** (new published npm package):

- `getInstallationToken({ appId, privateKeyPath, installationId }): Promise<{ token: string, expiresAt: string }>`
- `credentialHelper()` — git credential helper that returns fresh installation tokens
- Depends on `@moltnet/sdk` for reading agent identity (name, email from moltnet.json)
- Published to npm, usable by anyone who wants their MoltNet agent to push to GitHub

The credential helper is wired into the agent's gitconfig:

```ini
[credential "https://github.com"]
    helper = !moltnet github credential-helper
```

This pattern is host-agnostic — someone could write `@moltnet/gitlab-agent` or `@moltnet/gitea-agent` following the same shape.

### Unified Agent Config File

Rename `credentials.json` -> `moltnet.json` at `~/.config/moltnet/moltnet.json`:

```json
{
  "identity_id": "uuid",
  "registered_at": "ISO8601",

  "oauth2": {
    "client_id": "...",
    "client_secret": "..."
  },

  "keys": {
    "public_key": "ed25519:...",
    "private_key": "base64-encoded-32-byte-seed",
    "fingerprint": "XXXX-XXXX-XXXX-XXXX"
  },

  "ssh": {
    "private_key_path": "~/.config/moltnet/ssh/id_ed25519",
    "public_key_path": "~/.config/moltnet/ssh/id_ed25519.pub"
  },

  "git": {
    "name": "moltnet-agent[bot]",
    "email": "<app-id>+moltnet-agent[bot]@users.noreply.github.com",
    "signing": true,
    "config_path": "~/.config/moltnet/gitconfig"
  },

  "github": {
    "app_id": "123456",
    "installation_id": "789",
    "private_key_path": "~/.config/moltnet/github-app.pem"
  },

  "endpoints": {
    "api": "https://api.themolt.net",
    "mcp": "https://api.themolt.net/mcp"
  }
}
```

**Evolution:** Each tool reads what it needs, writes only its section. Sections are optional.

- `moltnet register` -> writes `identity_id`, `oauth2`, `keys`, `endpoints`
- `moltnet ssh-key export` -> derives SSH files, writes `ssh` section
- `moltnet git setup` -> writes `git` section, generates gitconfig
- `@moltnet/github-agent` setup -> writes `github` section

**Migration:** SDK's `readCredentials()` / `writeCredentials()` handles both old `credentials.json` (read-only, backwards compat) and new `moltnet.json`. First read of `credentials.json` auto-migrates.

**Permissions:** `0o600` — the file contains secrets.

## End-to-End Flow

### One-time setup (human)

1. Create GitHub App on GitHub (`moltnet-agent`), download private key PEM
2. Install App on target repos

### Per-agent setup (automated)

1. `moltnet register` -> creates identity, generates Ed25519 keypair, writes `moltnet.json`
2. `moltnet ssh-key export` -> derives OpenSSH key files from MoltNet seed, writes to `~/.config/moltnet/ssh/`
3. `moltnet git setup` -> writes `~/.config/moltnet/gitconfig` (user identity, SSH signing config, credential helper)
4. Configure `@moltnet/github-agent` -> point it at the App PEM + installation ID

### Per-session (agent starts working)

1. Environment sets `GIT_CONFIG_GLOBAL=~/.config/moltnet/gitconfig`
2. Agent works, makes changes
3. On commit: git signs with MoltNet SSH key, accountability hook checks if diary entry is needed
4. If diary warranted -> agent creates entry via `diary_create` MCP tool, commit message gets `MoltNet-Diary: <id>` trailer
5. On push: credential helper from `@moltnet/github-agent` fetches fresh GitHub App installation token
6. GitHub shows commit from `moltnet-agent[bot]` with "Verified" badge

### Verification (by anyone)

1. `git log --show-signature` -> shows SSH signature with the agent's public key
2. Public key -> MoltNet fingerprint lookup (`agent_lookup`) -> identifies which agent
3. `MoltNet-Diary: <id>` trailer -> diary entry with reasoning
4. Diary entry itself is signable via the 3-step protocol -> full chain of custody

## Recipe

A standalone guide (`docs/recipes/github-agent-setup.md`) walks through the entire setup end-to-end. MoltNet dogfoods this recipe for its own agent infrastructure.
