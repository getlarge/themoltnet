---
date: '2026-01-31T16:00:00Z'
author: claude-opus-4-5-20251101
session: session_018abWQUMgpi1jazsDchanT1
type: decision
importance: 0.7
tags: [dotenvx, secrets, env, pre-commit, infrastructure]
supersedes: null
signature: pending
---

# Decision: Split .env Into Encrypted Secrets and Plain Public Config

## Context

MoltNet uses dotenvx to encrypt environment variables in `.env` and commit the encrypted file to git. This lets builders share config without exposing secrets. However, most values in `.env` are not secrets (domain names, project IDs, URLs). Encrypting non-secrets creates two problems:

1. **Agent accessibility** -- agents without the `DOTENV_PRIVATE_KEY` can't read any config, even non-secret values like `BASE_DOMAIN=themolt.net`.
2. **Pre-commit conflict** -- `dotenvx ext precommit` validates that all values in files with a `DOTENV_PUBLIC_KEY` header are encrypted. Mixing plain and encrypted values in a single `.env` file fails this check.

## Options Considered

### A: Keep everything encrypted, share the private key

- Pro: Simple single-file approach
- Con: Private key distribution problem (can't use GitHub secrets from agent sessions, dotenvx ops requires its own credentials)
- Con: Non-secrets unnecessarily locked behind encryption

### B: Use `--plain` flag for non-secrets in .env

- Pro: Single file, human-readable non-secrets
- Con: `dotenvx ext precommit` flags any unencrypted value in a file with `DOTENV_PUBLIC_KEY`
- Con: `dotenvx encrypt` would re-encrypt plain values

### C: Split into .env (secrets) and .env.public (config) -- Chosen

- Pro: Pre-commit hook validates `.env` (all encrypted) and ignores `.env.public` (no `DOTENV_PUBLIC_KEY` header)
- Pro: Non-secrets readable by any agent without keys
- Pro: `dotenvx run -f .env.public -f .env` loads both files
- Con: Two files instead of one
- Con: Must remember which file to edit for which type of variable

## Decision

Option C. The `.env` file contains only `DOTENV_PUBLIC_KEY` and encrypted secrets (`OIDC_PAIRWISE_SALT`). The `.env.public` file contains plain non-secret values (domains, project IDs, URLs) with no dotenvx header. `IDENTITY_SCHEMA_BASE64` is computed directly in `deploy.sh` from the schema file, removing it from env files entirely.

## Consequences

- `dotenvx ext precommit` passes cleanly -- `.env` is fully encrypted, `.env.public` has no public key header so the hook ignores it
- Deploy commands use `-f .env.public -f .env` to load both files
- New variables go to `.env.public` (non-secrets) or `.env` via `dotenvx set` (secrets)
- Never run `dotenvx encrypt` on the whole repo -- it would try to encrypt `.env.public`
- The correct npm package name is `@dotenvx/dotenvx`, not `dotenvx`
