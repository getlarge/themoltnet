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

## What Was Done This Session

### SSH Key Conversion (crypto-service + Go CLI)

- `toSSHPublicKey()` / `toSSHPrivateKey()` in `libs/crypto-service/src/ssh.ts` — converts MoltNet Ed25519 keys to OpenSSH format
- Same functions in `cmd/moltnet/ssh.go` using `golang.org/x/crypto/ssh`
- `moltnet ssh-key` subcommand writes key files with proper permissions (0o600/0o644)
- Shared cross-platform test vectors in `test-fixtures/ssh-key-vectors.json`

### Config Evolution (SDK + Go CLI)

- `credentials.json` → `moltnet.json` with 3 minor version backwards compat
- New `MoltNetConfig` type with optional `ssh`, `git`, `github` sections
- `readConfig()` / `writeConfig()` / `updateConfigSection()` in both TypeScript and Go
- Deprecated `readCredentials()` / `writeCredentials()` as wrappers

### SDK `exportSSHKey()`

- Reads config, converts keys, writes files, updates `ssh` section in `moltnet.json`
- Proper file permissions and error messages with config path

### `@moltnet/github-agent` Package

- New package at `packages/github-agent/`
- `setupGitIdentity()` — generates gitconfig + allowed_signers for SSH commit signing
- `getInstallationToken()` — GitHub App JWT → installation access token exchange
- `credentialHelper()` — git credential protocol output for push authentication

### Go CLI Subcommands

- `moltnet git setup` — generates gitconfig + allowed_signers, updates config
- `moltnet github credential-helper` — GitHub App token exchange for git pushes

### `/accountable-commit` Skill

- Risk classification (high/medium/low) based on file paths
- Signed diary entries using `<moltnet-signed>` TDB envelope format
- `MoltNet-Diary:` commit trailer linking commits to diary entries

### Documentation

- End-to-end recipe at `docs/recipes/github-agent-setup.md`
- Design doc status updated to "Implemented"

## Mission Integrity Assessment

This work directly strengthens MoltNet's core mission of agent sovereignty:

- **T1 (Cryptographic Anchoring)**: Extended — agents can now sign git commits with the same Ed25519 keys used for diary entries. The `<moltnet-signed>` TDB envelope creates tamper-evident audit trails.
- **T4 (Offline-First Verification)**: SSH signatures are verifiable by any standard SSH tooling, no MoltNet server needed. `git log --show-signature` works standalone.
- **T7 (Dependency Hardening)**: SSH key conversion uses the same `@noble/ed25519` library already in the trusted path. Go CLI uses stdlib `crypto/ed25519` + `golang.org/x/crypto/ssh`.
- **Agent sovereignty**: Agents hold their own keys, sign their own commits, and authenticate to GitHub via their own App credentials. No human keys involved.
- **Accountability**: The accountable-commit skill creates a cryptographic link between code changes and diary entries, making agent decisions auditable.

### Potential concerns

- GitHub App private key (RSA) is stored as a file. This is external to MoltNet's Ed25519 infrastructure — it's a GitHub requirement, not a compromise of the identity model.
- The credential helper outputs tokens to stdout. This is standard git credential protocol. Tokens are short-lived (1 hour).

## Continuity Notes

- The `/accountable-commit` skill needs manual testing with a live MCP connection
- Consider adding the SSH public key to GitHub's vigilant mode for "Verified" badges
- The `<moltnet-signed>` TDB envelope format should be formally specified and added to MISSION_INTEGRITY.md once validated in practice
- Key rotation (T5) is not yet implemented — rotating MoltNet keys would need to regenerate SSH keys and update git identity
