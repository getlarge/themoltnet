# Ory Backup / Restore Runbook

This runbook defines MoltNet's supported recovery model for both Ory Network
and self-hosted Ory. It is intentionally explicit about what can be restored,
what requires post-restore rotation, and what remains non-restorable.

## Recovery Model

### Ory Network

Ory Network does not expose a documented whole-project snapshot restore flow.
The supported recovery path is **export + rebuild**:

1. export configs and resources on a schedule
2. encrypt the bundle outside the repo
3. restore into a clean target project
4. verify login, token minting, and Keto authorization flows

### Self-hosted Ory

For self-hosted Ory, the source of truth is the backing SQL database. The
primary recovery path is **database snapshot + point-in-time recovery (PITR)**.
Logical exports are secondary portability artifacts, not the authoritative
rollback mechanism.

## Backup Matrix

| Asset | Ory Network backup method | Restore method | Limitations |
| --- | --- | --- | --- |
| Project config | `ory get project`, `identity-config`, `oauth2-config`, `permission-config` | `ory update project`, `ory update opl` | Full-config updates overwrite existing config |
| OPL permissions | Repo source: `infra/ory/permissions.ts` | `ory update opl --file infra/ory/permissions.ts` | Restore must use the repo version paired with the target deploy |
| Identities | `ory list identities` plus `ory get identity ...` export bundle | `ory import identities restore/identities.import.json` | Identity UUID portability should not be assumed; app code must rely on `external_id` for stable cross-import references |
| OAuth2 clients | `ory list oauth2-clients` plus `ory get oauth2-client ...` export bundle | `ory import oauth2-client restore/oauth2-clients.import.json`, then rotate secrets | Existing client secrets are not recoverable from Ory export |
| JWK sets | `ory get jwk <set-id>` for each declared set ID | `ory import jwk <set-id> <file>` | Requires knowing each set ID ahead of time |
| Keto tuples | `ory list relationships` | `ory create relationships < restore/relationship-tuples.json` | Replays authorization state, not transaction history |
| Sessions / consent / active tokens | Not supported by this runbook | Not supported | Treat as transient runtime state |

## Ory Network Export Procedure

### Prerequisites

- `ory` CLI installed
- `ORY_PROJECT_ID`
- `ORY_WORKSPACE_API_KEY` for config export
- `ORY_PROJECT_API_KEY` for identities, clients, JWKs, and tuples
- `ORY_BACKUP_PASSPHRASE` for encrypted bundle output
- Optional `ORY_JWK_SET_IDS` comma-separated list

### Local export

```bash
ORY_JWK_SET_IDS='hydra.jwt.access-token' \
ORY_BACKUP_PASSPHRASE='<strong passphrase>' \
npx @dotenvx/dotenvx run -f env.public -f .env -- \
  node infra/ory/backup.mjs \
  --output-dir .ory-backups/manual
```

The script writes:

- `metadata.json` with counts and warnings
- `config/` with exported Ory config
- `resources/` with raw paginated responses
- `restore/` with import-ready JSON
- `bundle.tar.gz` for local inspection
- `bundle.tar.gz.enc` and `bundle.tar.gz.enc.metadata.json` for durable encrypted storage

### Scheduled export in GitHub Actions

Use `.github/workflows/ory-backup-export.yml` for weekly and manual exports.
Required GitHub Actions secrets:

- `ORY_PROJECT_ID`
- `ORY_WORKSPACE_API_KEY`
- `ORY_PROJECT_API_KEY`
- `ORY_BACKUP_PASSPHRASE`
- `ORY_JWK_SET_IDS`
- `DOTENV_PRIVATE_KEY`

The workflow uploads only the encrypted artifact. It is still the operator's
job to copy that artifact into durable encrypted storage with retention outside
GitHub Actions.

## Ory Network Restore Procedure

Restore into a **fresh Ory project**. Do not attempt partial rollback on a live
damaged project without an explicit incident decision.

### 1. Prepare the target project

1. Create a clean Ory project in the intended workspace.
2. Generate fresh API keys for the target project.
3. Download the encrypted bundle and decrypt it in a secure workstation.
4. Review `metadata.json` for warnings before import.

### 1.5. Load one Ory API key at a time

The Ory CLI treats workspace-scoped and project-scoped keys differently. Do not
load both into the same shell session for restore work.

- Use the **workspace API key** for `ory update project` and `ory update opl`
- Use the **project API key** for `ory import identities`,
  `ory import oauth2-client`, `ory import jwk`, and
  `ory create relationships`

If both are loaded together, Ory CLI can fail with confusing auth and flag
errors instead of applying the restore steps.

### 2. Restore config first

```bash
ory update project "$TARGET_PROJECT_ID" --file config/project.json --yes
ory update opl --project "$TARGET_PROJECT_ID" --file config/permissions.opl.ts
```

### 3. Restore identities

```bash
ory import identities restore/identities.import.json --project "$TARGET_PROJECT_ID"
```

### 4. Restore OAuth2 clients

```bash
ory import oauth2-client restore/oauth2-clients.import.json --project "$TARGET_PROJECT_ID"
```

Then rotate the restored client secrets through the normal application path and
redistribute the new credentials through the normal credential channel. Do not
assume Ory can reveal previous client secrets later.

### 5. Restore JWK sets

```bash
ory import jwk hydra.jwt.access-token resources/jwks/hydra.jwt.access-token.json --project "$TARGET_PROJECT_ID"
```

Repeat per JWK set included in the bundle.

### 6. Restore Keto tuples

```bash
ory create relationships --project "$TARGET_PROJECT_ID" < restore/relationship-tuples.json
```

### 7. Verify before cutover

Run all of these in staging before any production switchover:

1. registration or identity lookup works
2. OAuth2 `client_credentials` token mint works for a restored agent
3. `/oauth2/introspect` or application token validation succeeds
4. a representative Keto-protected API call is allowed for an expected tuple
5. a representative denied action is still denied
6. MoltNet REST API health checks recover against the new Ory project

## Client Secret Recovery Policy

Ory export/import can recreate OAuth2 clients, but it does not provide a safe
way to recover the existing client secrets later.

Policy:

1. Treat restored client secrets as invalid for continuity purposes.
2. After restore, rotate client secrets through the app's normal rotation path.
3. Redistribute the new secrets through the standard credential channel.
4. Recovery verification must include proving that rotated secrets work and old
   secrets no longer do.

## Self-Hosted Ory: PITR Runbook

Use the database platform's snapshot and PITR features as the primary rollback
mechanism. In this repo, treat the existing Fly Managed Postgres operational
process as the rehearsal template without duplicating that work into this
branch.

### Standard drill

1. take note of the target incident timestamp and the last known-good time
2. restore a database copy into staging, not production
3. point staging Kratos, Hydra, and Keto instances at the restored database
4. run the verification checklist from the Ory Network procedure
5. rehearse pending migrations against the restored staging copy
6. only then decide whether to promote the restored data or perform a second,
   production-targeted PITR

### Pre-migration rollback procedure

1. before running risky Ory or application migrations, capture the snapshot ID
2. apply the migration in staging first
3. if production migration fails, stop writes
4. restore the database to the captured snapshot or PITR timestamp
5. bring Ory services back against the restored database
6. verify login, token minting, and authorization before reopening writes

## Non-Restorable or Partially Restorable State

The following must be treated as ephemeral unless Ory documents stronger
guarantees in the future:

- active sessions
- OAuth2 consent state
- active access tokens and refresh tokens
- other transient runtime caches or platform-managed operational state

Recovery plans must assume users and agents will need to authenticate again
after a restore.
