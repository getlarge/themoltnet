# Plan: Harden Ory Infrastructure Configs (Issue #72)

## Context

Security audit (#69) found that Ory configs have insecure defaults in both production (`project.json` deployed to Ory Network) and local dev configs (`hydra.yaml`, `kratos.yaml`, `docker-compose.yaml`). This plan addresses all 13 checklist items from the issue.

**Key insight**: Production uses Ory Network (managed), configured via `infra/ory/project.json`. Local Docker configs are dev/CI only. Changes must be applied in the right place.

**Secrets approach**: Non-sensitive defaults (DB passwords) stay inline with `${VAR:-default}`. Sensitive secrets (Hydra system secret, OIDC salt) move to an encrypted `.env.docker` loaded via `npx dotenvx run -f .env.docker -- docker compose ...`.

**Dev flags approach**: Use Docker Compose `extends` pattern (already in place for base/dev/e2e). Harden the base configs (no `--dev`, no admin ports), add them back in the extending dev/e2e files.

---

## Step 1: Production config — `infra/ory/project.json`

| Line    | Current                               | New                                     | Severity |
| ------- | ------------------------------------- | --------------------------------------- | -------- |
| 35      | `"haveibeenpwned_enabled": false`     | `true`                                  | High     |
| 137-139 | cookie: `{ "same_site": "Lax" }`      | Add `"secure": true, "http_only": true` | Medium   |
| 163     | `"max_ttl": "720h"`                   | `"2h"`                                  | Medium   |
| 167     | `"default_grant_allowed_scope": true` | `false`                                 | High     |
| 173     | `"enforced": false`                   | `true`                                  | Medium   |

Already correct: `expose_internal_errors: false` (line 158), OIDC salt uses `${OIDC_PAIRWISE_SALT}` (line 181).

## Step 2: Local Hydra config — `infra/ory/hydra/hydra.yaml`

| Line  | Current                                             | New                                                           |
| ----- | --------------------------------------------------- | ------------------------------------------------------------- |
| 47    | `expose_internal_errors: true`                      | `false`                                                       |
| 52    | `max_ttl: 720h`                                     | `2h`                                                          |
| 54    | `default_grant_allowed_scope: true`                 | `false`                                                       |
| 58    | `enforced: false`                                   | `true`                                                        |
| 65-66 | `pairwise: salt: local-dev-salt-not-for-production` | Keep as fallback; docker-compose env var overrides at runtime |

For the salt: Hydra reads `OIDC_SUBJECT_IDENTIFIERS_PAIRWISE_SALT` env var which overrides the yaml config. Docker-compose already passes this. The yaml value is already overridden at runtime. Update the docker-compose env var to come from `.env.docker`.

## Step 3: Local Kratos config — `infra/ory/kratos/kratos.yaml`

| Line   | Current                         | New                                                                            |
| ------ | ------------------------------- | ------------------------------------------------------------------------------ |
| 52     | `haveibeenpwned_enabled: false` | `true`                                                                         |
| 99-100 | `cookie: same_site: Lax`        | Add `http_only: true` (leave `secure` absent — defaults to false for HTTP dev) |
| 104    | `skip_ssl_verify=true`          | Add comment: `# DEV ONLY — production uses Ory Network managed SMTP`           |

## Step 4: Docker-compose secrets — `.env.docker` + `docker-compose.yaml`

**Create `.env.docker`** (encrypted via dotenvx, committed):

```bash
npx @dotenvx/dotenvx set HYDRA_SECRETS_SYSTEM "$(openssl rand -base64 32)" -f .env.docker
npx @dotenvx/dotenvx set OIDC_PAIRWISE_SALT "$(openssl rand -base64 32)" -f .env.docker
```

**Update `docker-compose.yaml`** hydra environment (lines 131-133):

```yaml
environment:
  DSN: postgres://hydra:${HYDRA_DB_PASSWORD:-hydra_secret}@hydra-postgres:5432/hydradb?sslmode=disable
  SECRETS_SYSTEM: ${HYDRA_SECRETS_SYSTEM} # from .env.docker (no default)
  OIDC_SUBJECT_IDENTIFIERS_PAIRWISE_SALT: ${OIDC_PAIRWISE_SALT} # from .env.docker (no default)
```

**Parameterize DB passwords** (keep inline defaults — non-sensitive for local containers):

- kratos-postgres env: `POSTGRES_PASSWORD: ${KRATOS_DB_PASSWORD:-kratos_secret}`
- kratos/kratos-migrate DSN: `postgres://kratos:${KRATOS_DB_PASSWORD:-kratos_secret}@...`
- hydra-postgres env: `POSTGRES_PASSWORD: ${HYDRA_DB_PASSWORD:-hydra_secret}`
- hydra/hydra-migrate DSN: `postgres://hydra:${HYDRA_DB_PASSWORD:-hydra_secret}@...`
- keto-postgres env: `POSTGRES_PASSWORD: ${KETO_DB_PASSWORD:-keto_secret}`
- keto/keto-migrate DSN: `postgres://keto:${KETO_DB_PASSWORD:-keto_secret}@...`

## Step 5: Harden `docker-compose.base.yaml` (base for extends)

Remove `--dev` flags and admin ports from the hardened base:

- Line 57: `serve --config ... --dev --watch-courier` → `serve --config ... --watch-courier`
- Line 60: Remove `- '4434:4434'` (kratos admin)
- Line 104: `serve all --config ... --dev` → `serve all --config ...`
- Line 107: Remove `- '4445:4445'` (hydra admin)
- Parameterize DB passwords and DSNs (same pattern as step 4)
- Remove default fallbacks from `SECRETS_SYSTEM` (line 110) and `OIDC_PAIRWISE_SALT` (line 111)

## Step 6: Update `docker-compose.dev.yaml` (extends base, adds dev relaxations)

Override kratos and hydra to restore `--dev` and admin ports:

```yaml
kratos:
  extends:
    file: docker-compose.base.yaml
    service: kratos
  command: serve --config /etc/config/kratos/kratos.yaml --dev --watch-courier
  ports:
    - '4433:4433' # Public API
    - '4434:4434' # Admin API (dev only)

hydra:
  extends:
    file: docker-compose.base.yaml
    service: hydra
  command: serve all --config /etc/config/hydra/hydra.yaml --dev
  ports:
    - '4444:4444' # Public API
    - '4445:4445' # Admin API (dev only)
```

## Step 7: Update `docker-compose.e2e.yaml` (extends base, adds --dev for HTTP)

E2E also needs `--dev` (no TLS between containers) but NOT admin ports:

```yaml
kratos:
  extends:
    file: docker-compose.base.yaml
    service: kratos
  command: serve --config /etc/config/kratos/kratos.yaml --dev --watch-courier

hydra:
  extends:
    file: docker-compose.base.yaml
    service: hydra
  command: serve all --config /etc/config/hydra/hydra.yaml --dev
```

## Step 8: Harden standalone `docker-compose.yaml`

Apply same changes as base:

- Line 70: Remove `--dev` from kratos
- Line 73: Remove `- '4434:4434'`
- Line 126: Remove `--dev` from hydra
- Line 129: Remove `- '4445:4445'`
- Parameterize DB passwords and secrets (same pattern as step 4)

Update usage comments to reflect new workflow:

```yaml
# Usage:
#   npx dotenvx run -f .env.docker -- docker compose --profile dev up -d     # Infra (hardened)
#   npx dotenvx run -f .env.docker -- docker compose --profile ci up -d      # Everything
#   docker compose -f docker-compose.dev.yaml up -d                          # Dev with --dev + admin ports
```

---

## Checklist mapping

| #   | Issue fix                             | File(s)                                               |
| --- | ------------------------------------- | ----------------------------------------------------- |
| 1   | `expose_internal_errors: false`       | hydra.yaml:47                                         |
| 2   | Remove default Hydra system secret    | docker-compose.yaml:132, base:110 → .env.docker       |
| 3   | OIDC pairwise salt env-var-only       | docker-compose.yaml:133, base:111 → .env.docker       |
| 4   | `default_grant_allowed_scope: false`  | hydra.yaml:54, project.json:167                       |
| 5   | `sslmode=require` for production DSNs | Ory Network manages this; local stays `disable`       |
| 6   | `haveibeenpwned_enabled: true`        | kratos.yaml:52, project.json:35                       |
| 7   | Session cookie `secure` + `http_only` | project.json:137-139, kratos.yaml:99-100              |
| 8   | DB passwords env-var-only             | docker-compose.yaml, base.yaml (with inline defaults) |
| 9   | Move `--dev` to dev-only extends      | base.yaml (remove), dev.yaml + e2e.yaml (add back)    |
| 10  | Remove admin ports from non-dev       | base.yaml (remove), dev.yaml (add back)               |
| 11  | SMTP `skip_ssl_verify`                | kratos.yaml:104 (comment, dev-only)                   |
| 12  | JWT `max_ttl` 720h → 2h               | hydra.yaml:52, project.json:163                       |
| 13  | PKCE enforced                         | hydra.yaml:58, project.json:173                       |

## Verification

1. `pnpm run validate` — all checks pass (no app code changes)
2. `docker compose -f docker-compose.dev.yaml config` — valid, includes `--dev` and admin ports
3. `docker compose -f docker-compose.e2e.yaml config` — valid, includes `--dev` but NO admin ports
4. `docker compose --profile dev config` — valid, NO `--dev`, NO admin ports (hardened standalone)
5. `jq . infra/ory/project.json` — valid JSON
6. Dry-run deploy: `npx @dotenvx/dotenvx run -f env.public -f .env -- ./infra/ory/deploy.sh`
