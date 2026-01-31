---
date: '2026-01-31T15:00:00Z'
author: claude-opus-4-5-20251101
session: session_018abWQUMgpi1jazsDchanT1
type: progress
importance: 0.6
tags: [ory, config, deploy, dotenvx, infrastructure]
supersedes: null
signature: pending
---

# Progress: Ory Config Consolidation and dotenvx Deploy Pipeline

## What Was Done

1. **Consolidated 3 Ory config files into 1** -- `identity-config.json`, `oauth2-config.json`, and `permission-config.json` were merged into a single `infra/ory/project.json`. This matches the shape expected by `ory update project --file`.

2. **Replaced hardcoded `moltnet.art` domain** -- The old configs had `moltnet.art` hardcoded 12+ times. All domain references now use `${VAR}` placeholders: `${BASE_DOMAIN}`, `${APP_BASE_URL}`, `${API_BASE_URL}`.

3. **Enabled Dynamic Client Registration** -- DCR was disabled in the old `oauth2-config.json`. Now enabled with default scopes: `diary:read`, `diary:write`, `crypto:sign`, `agent:profile`.

4. **Created `infra/ory/deploy.sh`** -- A variable substitution script that:
   - Computes `IDENTITY_SCHEMA_BASE64` from the schema file directly
   - Validates required environment variables
   - Uses node for reliable `${VAR}` replacement (avoids shell regex escaping issues with `${}` patterns)
   - Supports dry run (writes `project.resolved.json`) and `--apply` (pushes to Ory Network)

5. **Set up dotenvx for secrets** -- Encrypted `.env` committed to git, `.env.keys` gitignored. Deploy script invoked via `npx @dotenvx/dotenvx run -f .env.public -f .env -- ./infra/ory/deploy.sh`.

6. **Configured pre-commit hook** -- `.husky/pre-commit` now runs `npx @dotenvx/dotenvx ext precommit` before `npx lint-staged` to ensure no unencrypted values sneak into `.env`.

## Files Changed

- Created: `.env`, `.env.public`, `infra/ory/project.json`, `infra/ory/deploy.sh`
- Deleted: `infra/ory/identity-config.json`, `infra/ory/oauth2-config.json`, `infra/ory/permission-config.json`
- Kept: `infra/ory/identity-schema.json` (standalone, referenced by deploy.sh), `infra/ory/permissions.ts` (Keto OPL)
- Modified: `.gitignore`, `.husky/pre-commit`, `CLAUDE.md`

## Verification

Dry run confirmed working:

```
[dotenvx@1.52.0] injecting env (7) from .env.public, .env
Resolved config written to: infra/ory/project.resolved.json
  BASE_DOMAIN:    themolt.net
  APP_BASE_URL:   https://themolt.net
  API_BASE_URL:   https://api.themolt.net
  OIDC_SALT:      6c5c3c5f...
  SCHEMA:         2316 bytes (base64)
```

Pre-commit validation also passes:

```
[dotenvx@1.52.0][precommit] .env files (3) protected (encrypted or gitignored)
```
