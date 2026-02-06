---
date: '2026-02-06T16:00:00Z'
author: claude-opus-4-6
session: bd768b0a-6b62-4739-b419-ad73416f039c
type: handoff
importance: 0.9
tags: [ory, security, production, deploy, ws2]
supersedes: null
signature: pending
---

# Handoff: Harden Ory Network Production Config (Issue #72)

## What Was Done This Session

Hardened the Ory Network production config and deployed it live.

### 5 Security Fixes Applied to `infra/ory/project.json`

1. **haveibeenpwned_enabled**: `false` -> `true` (password breach checking)
2. **Session cookie**: added `secure: true`, `http_only: true`
3. **JWT max_ttl**: `720h` -> `2h` (was 30 days, now 2 hours)
4. **default_grant_allowed_scope**: `true` -> `false` (explicit scope required)
5. **PKCE enforced**: `false` -> `true` for all clients

### Config Cleanup

- Removed Ticketing project traces (webhook URLs pointing to `mbp.getlarge.eu`, display names saying "Ticketing")
- Replaced with MoltNet-specific config (webhook URLs to `api.themolt.net`, MoltNet branding)
- Removed Ory-managed keys that produce warnings: `expose_internal_errors`, `encrypt_at_rest`, `urls.self.public`

### Deploy Script Rewrite (`infra/ory/deploy.sh`)

- Replaced `ory` CLI usage with direct curl to `PUT https://api.console.ory.sh/projects/{id}` (CLI v1.2.0 has a bug where `ory auth` and all commands fail with "Access credentials are invalid" even with valid `ORY_WORKSPACE_API_KEY`)
- Fixed macOS base64 compatibility: `base64 "$file"` -> `base64 -i "$file"`
- Auth via `ORY_WORKSPACE_API_KEY` (workspace API key, `ory_wak_` prefix)
- Displays Ory API warnings after successful deploy

### New Secrets in `.env`

- `ORY_PROJECT_API_KEY` (`ory_pat_` prefix) - for Ory SDK/admin API calls from the REST API
- `ORY_ACTION_API_KEY` - used by Ory webhooks to authenticate with MoltNet (`X-Ory-Api-Key` header)
- `ORY_WORKSPACE_API_KEY` (`ory_wak_` prefix) - for deploy script to manage project config

## Discoveries

- **Ory CLI v1.2.0 bug**: All commands fail with "Access credentials are invalid" regardless of auth method (session, workspace key, project key). Direct API calls with the same workspace key work fine (HTTP 200). Filed no issue yet.
- **Ory-managed settings**: `expose_internal_errors`, `session.encrypt_at_rest`, and `urls.self.public` are managed by Ory based on tenant type and cannot be overridden via config. Setting them produces warnings.
- **Environment and dev mode**: Controlled by Ory based on tenant type (dev vs production subscription), not configurable via project config.
- **Opaque tokens + claim enrichment**: Access token strategy `opaque` still supports claim enrichment via the token hook / introspection endpoint. No need to switch to `jwt` strategy.
- **Three distinct Ory API keys**: workspace key (`ory_wak_`) manages project config, project key (`ory_pat_`) manages project data (identities, sessions), action key (plain string) authenticates webhook callbacks.

## What's Not Done Yet

- Scope was intentionally trimmed: local Docker configs (hydra.yaml, kratos.yaml, keto.yaml, docker-compose files) are dev-only and not security-critical for production
- Custom domain setup for Ory (currently using `tender-satoshi-rtd7nibdhq.projects.oryapis.com`)
- Identity schema is still `preset://email` on Ory Network (MoltNet agent schema exists in project.json but needs the custom schema uploaded separately)

## Current State

- Branch: `claude/harden-ory-configs-72`
- All 5 security fixes deployed live to Ory Network project `7219f256-464a-4511-874c-bde7724f6897`
- Deploy script works: `npx @dotenvx/dotenvx run -f env.public -f .env -- ./infra/ory/deploy.sh --apply`
- CI should pass (no code changes, only infra config)
