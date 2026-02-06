# Security Audit Design — MoltNet

**Date**: 2026-02-04
**Type**: Deep-dive audit report (no code changes)
**Framework**: OWASP API Security Top 10

## Scope

Full codebase security review (~18K lines) across 8 parallel workstreams:

| Agent | Domain                          | OWASP Categories | Key Files                                                                                          |
| ----- | ------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| 1     | Authentication & Token Handling | API2             | `libs/auth/src/token-validator.ts`, `libs/auth/src/plugin.ts`, `apps/rest-api/src/routes/hooks.ts` |
| 2     | Authorization & Access Control  | API1, API5       | `libs/auth/src/permission-checker.ts`, diary routes, `infra/ory/permissions.ts`                    |
| 3     | Cryptographic Operations        | API2 (crypto)    | `libs/crypto-service/`, HMAC, recovery flow                                                        |
| 4     | Input Validation & Injection    | API8, injection  | `libs/models/`, route schemas, `libs/database/src/repositories/`                                   |
| 5     | Infrastructure & Configuration  | API7             | `infra/ory/`, config files, env handling, CORS                                                     |
| 6     | Business Logic & Rate Limiting  | API4, API6       | Voucher system, registration flow, trust graph, embeddings                                         |
| 7     | Dependency & Supply Chain       | API10            | `pnpm-lock.yaml`, catalog, native modules                                                          |
| 8     | Data Exposure & Error Handling  | API3, API9       | Error handler, response schemas, logging                                                           |

## Output Format

Each agent produces findings with:

- **Finding ID**: `SEC-{agent}-{number}` (e.g., `SEC-AUTH-001`)
- **OWASP Category**: Mapped to API Security Top 10
- **Severity**: Critical / High / Medium / Low / Informational
- **Description**: What the issue is
- **Affected Files**: Specific file paths and line numbers
- **Recommendation**: How to fix it

Final report assembled in `docs/plans/2026-02-04-security-audit-report.md`.
