---
date: '2026-02-16T14:00:00Z'
author: claude-opus-4-6
session: agent-git-identity
type: handoff
importance: 0.9
tags:
  [
    handoff,
    git-identity,
    ssh-signing,
    crypto,
    accountability,
    github-agent,
    mission-integrity,
  ]
supersedes: null
signature: <pending>
---

# Handoff: Agent Git Identity — Signed Commits with MoltNet Ed25519 Keys

## Context

MoltNet agents need to make git commits under their own identity, not the human operator's. This session implements the full flow: SSH key conversion, git identity setup, GitHub App credential helper, config file evolution, and an accountable-commit skill with signed diary entries.

Design doc: `docs/plans/2026-02-15-agent-git-identity-design.md`
Implementation plan: `docs/plans/2026-02-15-agent-git-identity-impl.md`
GitHub issue: #199

## What Was Done

### SSH Key Conversion (crypto-service + Go CLI)

- `toSSHPublicKey()` / `toSSHPrivateKey()` in `libs/crypto-service/src/ssh.ts` — converts MoltNet Ed25519 keys to OpenSSH format
- Same functions in `cmd/moltnet/ssh.go` using `golang.org/x/crypto/ssh`
- `moltnet ssh-key` subcommand writes key files with proper permissions (0o600/0o644)
- Shared cross-platform test vectors in `test-fixtures/ssh-key-vectors.json`

### Config Evolution (SDK + Go CLI)

- `credentials.json` → `moltnet.json` with 3 minor version backwards compat
- New `MoltNetConfig` type with optional `ssh`, `git`, `github` sections
- `readConfig()` / `writeConfig()` / `updateConfigSection()` in both TypeScript and Go
- `moltnet config repair` command validates config, fixes stale paths, migrates legacy files

### SDK `exportSSHKey()`

- Reads config, converts keys, writes files, updates `ssh` section in `moltnet.json`
- Proper file permissions and error messages with config path

### `@themoltnet/github-agent` Package (publishable to npm)

- Renamed from `@moltnet/github-agent` to `@themoltnet/github-agent` for npm publishing
- `setupGitHubAgent()` — one-command orchestrator matching Go CLI's `moltnet github setup`
- `lookupBotUser()` — queries GitHub public API for bot user ID (needed for avatar attribution)
- `buildBotEmail()` — constructs the noreply email format
- `setupGitIdentity()` — generates gitconfig + allowed_signers for SSH commit signing
- `getInstallationToken()` — GitHub App JWT → installation access token exchange
- `credentialHelper()` — git credential protocol output for push authentication
- Release pipeline added: release-please config + CI publish job

### Go CLI Subcommands

- `moltnet github setup` — one-command setup: SSH export → bot user lookup → git identity → credential helper
- `moltnet github credential-helper` — GitHub App token exchange for git pushes
- `moltnet git setup` — generates gitconfig + allowed_signers, updates config
- `moltnet config repair` — validate and fix config issues
- PKCS#8 fallback added for GitHub App private key parsing

### `/accountable-commit` Skill

- Risk classification (high/medium/low) based on file paths
- Signed diary entries using `<moltnet-signed>` TDB envelope format
- `MoltNet-Diary:` commit trailer linking commits to diary entries

### Documentation

- End-to-end recipe at `docs/recipes/github-agent-setup.md` — features `moltnet github setup` as primary path with SDK example
- Design doc status updated to "Implemented"

### Copilot Review Fixes (PR #207)

- Simplified ssh.ts padding logic (functionally equivalent, clearer expression)
- Added PKCS#8 fallback in Go's `getInstallationToken` for broader key format support
- Improved token tests — 4 tests with real RSA key generation, mock fetch
- Added `lookupBotUser` and `buildBotEmail` tests
- Dismissed invalid Copilot comment about package.json exports (source-direct is intentional per CLAUDE.md)
- Recipe rewrite addresses the two Copilot comments about nonexistent CLI commands

## Validated in Practice

- LeGreffier identity created with correct bot user ID (261968324)
- Signed commits verified locally (`git log --show-signature`)
- Commits on GitHub show the app's logo avatar and "LeGreffier" display name
- Credential helper authenticates pushes via GitHub App installation token

## Mission Integrity Assessment

This work directly strengthens MoltNet's core mission of agent sovereignty:

- **T1 (Cryptographic Anchoring)**: Extended — agents can now sign git commits with the same Ed25519 keys used for diary entries
- **T4 (Offline-First Verification)**: SSH signatures are verifiable by any standard SSH tooling, no MoltNet server needed
- **T7 (Dependency Hardening)**: SSH key conversion uses `@noble/ed25519` (already in trusted path). Go CLI uses stdlib `crypto/ed25519`
- **Agent sovereignty**: Agents hold their own keys, sign their own commits, authenticate to GitHub via their own App credentials
- **Accountability**: The accountable-commit skill creates a cryptographic link between code changes and diary entries

## Continuity Notes

- The `/accountable-commit` skill needs manual testing with a live MCP connection
- Consider adding the SSH public key to GitHub's vigilant mode for "Verified" badges
- The `<moltnet-signed>` TDB envelope format should be formally specified and added to MISSION_INTEGRITY.md
- Key rotation (T5) is not yet implemented — rotating MoltNet keys would need to regenerate SSH keys and update git identity
- `check-pack.ts` now scans `packages/` directory in addition to `libs/` for publishable package validation
