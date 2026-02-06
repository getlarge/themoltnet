# Plan: Harden Ory Infrastructure Configs (Issue #72)

## Context

Security audit (#69) found insecure defaults in the Ory Network production config (`project.json`). Since MoltNet uses Ory Network (managed) for deployment, only `project.json` needs hardening — local Docker configs (`hydra.yaml`, `kratos.yaml`, `docker-compose.yaml`) are dev-only and Ory manages TLS, ports, DB connections, and secrets. When self-hosting, safe values can be exported from Ory Network.

## Scope: 5 production fixes in `infra/ory/project.json`

| #   | Fix                                   | Line    | Before  | After   | Severity |
| --- | ------------------------------------- | ------- | ------- | ------- | -------- |
| 1   | Enable HaveIBeenPwned password check  | 35      | `false` | `true`  | High     |
| 2   | Session cookie `secure` + `http_only` | 137-139 | absent  | `true`  | Medium   |
| 3   | JWT grant `max_ttl` 720h to 2h        | 163     | `720h`  | `2h`    | Medium   |
| 4   | `default_grant_allowed_scope`         | 167     | `true`  | `false` | High     |
| 5   | PKCE enforced globally                | 173     | `false` | `true`  | Medium   |

### Out of scope (dev-only, managed by Ory Network)

Items 1-3, 5, 8-11 from the original issue (#72) target local Docker configs. These are not production-deployed and don't need hardening — Ory Network handles `expose_internal_errors`, system secrets, `--dev` flags, admin ports, DB passwords, SSL modes, and SMTP.

## Verification

1. `jq . infra/ory/project.json` — valid JSON
2. `npx @dotenvx/dotenvx run -f env.public -f .env -- ./infra/ory/deploy.sh` — dry run
3. `npx @dotenvx/dotenvx run -f env.public -f .env -- ./infra/ory/deploy.sh --apply` — deploy
