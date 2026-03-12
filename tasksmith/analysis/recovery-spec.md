# Recovery Spec: fixture_already_green → verified

Generated: 2026-03-11
Source: 78 fixture_already_green rejections
Goal: recover 10-15 tasks in priority families (rest-api-route, service-logic, mcp-tooling, codegen)

## Recovery Queue (ordered by effort/yield)

### Tier 1 — Easy wins: new test names exist, just add --grep (8 tasks)

These tasks added new `it()`/`describe()` blocks. The whole test file passes on
fixture because pre-existing tests are green. Narrowing to the new test names
makes fixture red.

#### 1. service-logic-add-diaryrepository-listbyids-bc311153

- Family: service-logic
- Current fail_to_pass: `pnpm --filter @moltnet/database run test -- __tests__/diary.repository.integration.test.ts`
- **Replace with:**
  ```
  pnpm --filter @moltnet/database run test -- __tests__/diary.repository.integration.test.ts --grep "returns diaries matching the given IDs"
  ```
- Why it works: Exact test name. `listByIds` method doesn't exist at fixture — test will throw.
- ready_to_apply: true

#### 2. service-logic-add-issueunlimited-to-voucherrepository-137b9201

- Family: service-logic
- Current fail_to_pass: `pnpm --filter @moltnet/database run test -- __tests__/voucher.repository.test.ts`
- **Replace with:**
  ```
  pnpm --filter @moltnet/database run test -- __tests__/voucher.repository.test.ts --grep "issues a voucher without checking the active voucher cap"
  ```
- Why it works: Exact test name. `issueUnlimited` method doesn't exist at fixture — test will throw.
- ready_to_apply: true

#### 3. service-logic-enforce-immutability-on-all-signed-field-b0af30df

- Family: service-logic
- Current fail_to_pass: `pnpm --filter @moltnet/diary-service run test -- __tests__/diary-service.test.ts`
- **Replace with:**
  ```
  pnpm --filter @moltnet/diary-service run test -- __tests__/diary-service.test.ts --grep "rejects title changes on signed entries"
  ```
- Why it works: Exact test name. At fixture, signed entries are mutable — the update succeeds instead of throwing.
- ready_to_apply: true

#### 4. service-logic-move-dbos-workflow-scheduling-inside-tra-5500c799

- Family: service-logic
- Current fail_to_pass: `pnpm --filter @moltnet/diary-service run test -- __tests__/diary-service.test.ts`
- **Replace with:**
  ```
  pnpm --filter @moltnet/diary-service run test -- __tests__/diary-service.test.ts --grep "creates entry and schedules Keto workflow atomically"
  ```
- Why it works: Exact test name under `describe("atomicity")`. Tests that `startWorkflow` is called inside `runTransaction` callback — at fixture, workflow is scheduled outside transaction.
- ready_to_apply: true

#### 5. mcp-tooling-remove-misleading-signing-payload-add-si-61ac8424

- Family: mcp-tooling
- Current fail_to_pass: `pnpm --filter @moltnet/mcp-server run test -- __tests__/crypto-tools.test.ts`
- **Replace with:**
  ```
  pnpm --filter @moltnet/mcp-server run test -- __tests__/crypto-tools.test.ts --grep "sign_message prompt returns step-by-step signing instructions"
  ```
- Why it works: Exact test name. The sign_message prompt doesn't exist at fixture — test will fail looking for it.
- ready_to_apply: true

#### 6. mcp-tooling-warn-when-system-entry-scan-limit-is-rea-4aa8fec5

- Family: mcp-tooling
- Current fail_to_pass: `pnpm --filter @moltnet/mcp-server run test -- __tests__/profile-utils.test.ts`
- **Replace with:**
  ```
  pnpm --filter @moltnet/mcp-server run test -- __tests__/profile-utils.test.ts --grep "warns when scan limit is reached without finding entries"
  ```
- Why it works: Exact test name. Warning logic doesn't exist at fixture — test will fail.
- ready_to_apply: true

#### 7. rest-api-route-validate-tags-query-param-length-and-cou-56e6a505

- Family: rest-api-route
- Current fail_to_pass: `pnpm --filter @moltnet/rest-api run test -- __tests__/diary.test.ts`
- **Replace with:**
  ```
  pnpm --filter @moltnet/rest-api run test -- __tests__/diary.test.ts --grep "rejects tag longer than 50 characters"
  ```
- Why it works: Exact test name. Tag length validation doesn't exist at fixture — request succeeds instead of returning 400.
- ready_to_apply: true

#### 8. rest-api-route-return-same-error-for-unknown-key-and-ba-4a919e83

- Family: rest-api-route
- Current fail_to_pass: `pnpm --filter @moltnet/rest-api run test -- __tests__/recovery.test.ts`
- **Replace with:**
  ```
  pnpm --filter @moltnet/rest-api run test -- __tests__/recovery.test.ts --grep "returns same error for unknown key as for bad signature"
  ```
- Why it works: Exact test name. At fixture, unknown key returns a different (more specific) error than bad signature.
- ready_to_apply: true

### Tier 2 — Medium wins: structural recovery via rg probes (4 tasks)

These tasks modified existing test bodies/setup but didn't add new `it()` blocks.
`--grep` won't help. Instead, probe for symbols that the gold fix introduces in
source files.

**These are structural_recovery tasks** — they verify symbol presence, not end
behavior. They are second-class compared to Tier 1 and should be treated as
provisional until they survive verify cleanly.

#### 9. service-logic-keto-first-listdiaries-creatediary-compe-432fe47c

- Family: service-logic
- Current fail_to_pass: 3 diary-service test files (whole suite)
- **Replace with:**
  ```
  rg -n 'listDiaryIdsByAgent' libs/diary-service/src/diary-service.ts
  ```
- Why it works: `listDiaryIdsByAgent` call is added by the fix. At fixture, `listDiaries` queries the DB directly, not Keto.
- Risk: LOW — method name is unique and task-specific.
- recovery_type: structural_recovery
- requires_manual_validation: true

#### 10. service-logic-add-structured-logging-for-business-oper-a2502cd3

- Family: service-logic
- Current fail_to_pass: `pnpm --filter @moltnet/diary-service run test -- __tests__/diary-service.test.ts`
- **Replace with:**
  ```
  rg -n 'logger: FastifyBaseLogger' libs/diary-service/src/types.ts
  ```
- Why it works: The fix adds `logger` as a required dependency in the DiaryService types. At fixture, the type doesn't include logger.
- Risk: LOW — exact type signature.
- recovery_type: structural_recovery
- requires_manual_validation: true

#### 11. mcp-tooling-expose-identity-id-and-client-id-in-iden-262c731d

- Family: mcp-tooling
- Current fail_to_pass: resources.test.ts + e2e (whole files)
- **Replace with:**
  ```
  rg -n 'identity_id.*client_id|client_id.*identity_id' apps/mcp-server/src/resources.ts
  ```
- Why it works: The fix adds these two fields to the identity resource response. At fixture, only `agent_id` is returned.
- Risk: LOW — both fields must appear together.
- recovery_type: structural_recovery
- requires_manual_validation: true

#### 12. mcp-tooling-expose-identity-id-and-client-id-in-molt-bcf7dd69

- Family: mcp-tooling
- Current fail_to_pass: identity-tools.test.ts + e2e (whole files)
- **Replace with:**
  ```
  rg -n 'identity_id.*client_id|client_id.*identity_id' apps/mcp-server/src/identity-tools.ts
  ```
- Why it works: Same pattern — fix adds identity_id/client_id to whoami tool output.
- Risk: LOW — exact field pair.
- recovery_type: structural_recovery
- requires_manual_validation: true

### Tier 3 — Needs investigation: broader changes, mixed signals (3 tasks)

#### 13. rest-api-route-add-route-specific-rate-limiting-to-publ-79ec8791

- Family: rest-api-route
- Current fail_to_pass: signing-requests.test.ts (whole file)
- **Replace with:**
  ```
  rg -n 'rateLimitRecovery|rateLimitPublicVerify' apps/rest-api/src/config.ts
  ```
- Why it works: The fix adds per-route rate-limit config keys. At fixture, only global rate limiting exists.
- Risk: MEDIUM — config keys might not be the strongest signal. May need a second probe on the plugin file.
- Fallback:
  ```
  rg -n 'rateLimitRecovery|rateLimitPublicVerify' apps/rest-api/src/plugins/rate-limit.ts
  ```
- recovery_type: structural_recovery
- requires_manual_validation: true

#### 14. grp-rest-api-route-add-consolidateresult-and-compileresult-6c9c3300

- Family: rest-api-route
- Current fail_to_pass: diary.test.ts (whole file)
- **Replace with:**
  ```
  rg -n 'ConsolidateResult|CompileResult' apps/rest-api/src/schemas.ts
  ```
- Why it works: These types are introduced by the grouped fix. At fixture, consolidate/compile responses use inline schemas.
- Risk: MEDIUM — if the type names exist as strings elsewhere, false positive. But schema.ts is specific enough.
- Note: The new test names are in NEW test files (diary-distill.test.ts, diary-entries.test.ts) that don't exist at fixture. Testing file absence is not a valid verifier — it proves the file is missing, not that behavior is broken. The rg probe on schema types is the best available option for this task.
- recovery_type: structural_recovery
- requires_manual_validation: true

#### 15. grp-service-logic-regenerate-clients-after-excludetags-upd-5256794c

- Family: service-logic
- Current fail_to_pass: 5 test files (whole suites)
- **Replace with:**
  ```
  pnpm --filter @moltnet/mcp-server run test -- __tests__/diary-tools.test.ts --grep "passes exclude_tags filter"
  pnpm --filter @moltnet/rest-api run test -- __tests__/diary-entries.test.ts --grep "passes excludeTags filter"
  ```
- Why it works: 2 new tests specifically for excludeTags parameter passing. At fixture, excludeTags isn't wired through.
- Risk: MEDIUM — depends on whether the test file itself exists at fixture for the grouped range.
- requires_manual_validation: true

## Summary

| Tier | Count | Families | Effort | Actionability |
|------|-------|----------|--------|---------------|
| Tier 1 (--grep, exact test names) | 8 | service-logic×4, mcp-tooling×2, rest-api-route×2 | ~1h total | ready_to_apply: all 8 |
| Tier 2 (rg probe, structural) | 4 | service-logic×2, mcp-tooling×2 | ~1h total | requires_manual_validation: all 4 |
| Tier 3 (investigation needed) | 3 | rest-api-route×2, service-logic×1 | ~2h total | requires_manual_validation: all 3 |
| **Total** | **15** | | |

## Expected outcome after recovery

| Family | Currently verified | After recovery | Target |
|--------|--------------------|----------------|--------|
| service-logic | 2 | 8-9 | 5+ |
| mcp-tooling | 2 | 6 | 5 |
| rest-api-route | 1 | 4-5 | 5+ |
| codegen | 0 | 0 | 5 |
| database-migration | 4 | 4 | — |
| infra-or-e2e | 4 | 4 | — |
| observability | 2 | 2 | — |
| auth-permissions | 1 | 1 | — |
| sdk-package | 1 | 1 | — |
| workflow | 1 | 1 | — |
| **Total** | **18** | **31-33** | **30** |

Codegen remains at 0. The codegen tasks in the rejected set are mostly
regeneration-only changes (backwards-compatible type additions) with no behavioral
tests to narrow. Recovering codegen tasks would require a different verifier type
(e.g., typecheck-based or schema diff probes), which is out of scope for this pass.

## Tasks NOT in this spec

### stale_fixture (16 tasks) — retry_as_grouped candidates

These are mostly config/infra changes where the single-commit or current group
boundary is wrong. Recovery requires re-running the grouping algorithm with
different parameters, not just changing fail_to_pass. Deferred.

### not_task_shaped (23 tasks) — permanent drops

Split into:
- **drop_permanently** (14): pure deletions, comment-only, import-path-only, dep bumps
- **needs_new_grader_type** (5): Go-surface changes tested with TS, build config, vite plugins
- **wrong_surface** (4): test-only rewrites, e2e corpus changes, CI workflow YAML
