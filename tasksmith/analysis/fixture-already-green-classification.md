# fixture_already_green Classification Report

Generated: 2026-03-11
Total fixture_already_green: 79

## Summary

| Classification     | Count | Priority family hits                                    |
|--------------------|-------|---------------------------------------------------------|
| weak_fail_to_pass  | 40    | rest-api-route: 10, mcp-tooling: 11, service-logic: 9, codegen: 0 |
| not_task_shaped    | 23    | rest-api-route: 5, mcp-tooling: 0, service-logic: 3, codegen: 0   |
| stale_fixture      | 16    | rest-api-route: 0, mcp-tooling: 4, service-logic: 2, codegen: 0   |

**Recoverable tasks identified: 15** (marked with a star below)

---

## weak_fail_to_pass (40 tasks)

Tasks where the verifier runs too broad a scope (full test file or package suite) so that existing tests pass at the fixture commit even though the gold fix introduces meaningful behavioral changes.

### rest-api-route-validate-tags-query-param-length-and-cou-56e6a505 *

- Family: rest-api-route
- Current fail_to_pass: `pnpm --filter @moltnet/rest-api run test -- __tests__/diary.test.ts`
- Why weak: Runs the entire diary.test.ts. The gold fix adds tag-length validation to `diary.ts` (+35 lines) and adds corresponding new test cases in diary.test.ts. The pre-existing tests in that file pass at fixture.
- Proposed fix: Use `--grep "tags.*length\|tags.*count\|tag validation"` to target only the new validation tests. Alternatively, use an rg probe: `rg -n 'maxTagLength\|MAX_TAG_COUNT' apps/rest-api/src/routes/diary.ts` since those constants are added by the fix.

### rest-api-route-return-same-error-for-unknown-key-and-ba-4a919e83 *

- Family: rest-api-route
- Current fail_to_pass: `pnpm --filter @moltnet/rest-api run test -- __tests__/recovery.test.ts`
- Why weak: Runs entire recovery.test.ts. The gold fix changes error handling to return the same error for unknown key and bad signature (-30/+9 lines in recovery.ts). The modified test expectations are buried among many passing tests.
- Proposed fix: `--grep "unknown key\|bad signature\|same error"` to target the specific error-unification tests. Or use rg probe on the unified error message string in recovery.ts.

### rest-api-route-add-route-specific-rate-limiting-to-publ-79ec8791 *

- Family: rest-api-route
- Current fail_to_pass: `pnpm --filter @moltnet/rest-api run test -- __tests__/signing-requests.test.ts`
- Why weak: The gold fix adds rate-limit config and route changes across 8 source files, but the verifier only runs signing-requests.test.ts. The actual behavioral change (rate limiting on public endpoints) is not captured by that test file. The signing-requests tests pass regardless.
- Proposed fix: Add an rg probe for the rate-limit config: `rg -n 'routeRateLimit\|perRoute.*rateLimit' apps/rest-api/src/plugins/rate-limit.ts`. Or better, use a test --grep targeting rate-limit specific assertions if they exist in any test file.

### rest-api-route-remove-legacy-diary-entry-alias-routes-a724cd90

- Family: rest-api-route
- Current fail_to_pass: 6 test files (diary-entries.test.ts + 5 e2e files)
- Why weak: This is a massive removal (-6713 lines). The gold fix removes legacy routes and rewrites tests to use new entry-centric routes. At the fixture, the old routes and old tests both still exist and pass. The new tests reference new route paths that don't exist yet.
- Proposed fix: Use changed-test selectors or rg probes for the new route paths: `rg -n '/diaries/.*/entries' apps/rest-api/src/routes/diary-entries.ts`. But the scale of change makes this hard to recover -- the tests were rewritten wholesale.

### service-logic-add-diaryrepository-listbyids-bc311153 *

- Family: service-logic
- Current fail_to_pass: `pnpm --filter @moltnet/database run test -- __tests__/diary.repository.integration.test.ts`
- Why weak: Runs entire integration test file. The gold fix adds `listByIds` method (+99 lines) and adds new test cases. Pre-existing tests pass at fixture.
- Proposed fix: `--grep "listByIds"` to target only the new method's tests.

### service-logic-add-issueunlimited-to-voucherrepository-137b9201 *

- Family: service-logic
- Current fail_to_pass: `pnpm --filter @moltnet/database run test -- __tests__/voucher.repository.test.ts`
- Why weak: Runs entire voucher.repository.test.ts. The gold fix adds `issueUnlimited()` method (+59 lines) and its tests. Pre-existing tests pass.
- Proposed fix: `--grep "issueUnlimited\|unlimited"` to target the new method's tests.

### service-logic-add-structured-logging-for-business-oper-a2502cd3 *

- Family: service-logic
- Current fail_to_pass: `pnpm --filter @moltnet/diary-service run test -- __tests__/diary-service.test.ts`
- Why weak: Runs entire diary-service.test.ts. The gold fix adds logger dependency to DiaryService and modifies test mocks to include logger. If the test file already had a mock structure that works without logger, pre-existing tests pass.
- Proposed fix: `--grep "logger\|logging\|structured"` or use an rg probe: `rg -n 'logger.*info\|logger.*warn' libs/diary-service/src/diary-service.ts` checking for the new logging calls.

### service-logic-enforce-immutability-on-all-signed-field-b0af30df *

- Family: service-logic
- Current fail_to_pass: `pnpm --filter @moltnet/diary-service run test -- __tests__/diary-service.test.ts`
- Why weak: Same broad test file. The gold fix adds immutability enforcement on signed fields (+120 lines) and new test assertions. Pre-existing tests pass because they don't attempt to mutate signed fields.
- Proposed fix: `--grep "immutab\|signed field\|nonce"` to target the new immutability tests.

### service-logic-keto-first-listdiaries-creatediary-compe-432fe47c *

- Family: service-logic
- Current fail_to_pass: 3 diary-service test files
- Why weak: Runs 3 entire test files. The gold fix adds Keto-first listDiaries + createDiary compensation (+66 lines). Tests pass at fixture because the old code path still works.
- Proposed fix: `--grep "Keto.*first\|listDiaries.*keto\|compensation"` or rg probe: `rg -n 'ketoClient\|compensat' libs/diary-service/src/diary-service.ts`.

### service-logic-move-dbos-workflow-scheduling-inside-tra-5500c799 *

- Family: service-logic
- Current fail_to_pass: `pnpm --filter @moltnet/diary-service run test -- __tests__/diary-service.test.ts`
- Why weak: Runs entire test file. The gold fix moves DBOS scheduling inside transaction (+691 lines - major restructuring with new test patterns). Pre-existing tests pass.
- Proposed fix: `--grep "transaction\|atomicity\|workflow.*inside"` or use rg probe on the new transaction wrapping: `rg -n 'runInTransaction.*scheduleWorkflow\|scheduleWorkflow.*transaction' libs/diary-service/src/diary-service.ts`.

### mcp-tooling-warn-when-system-entry-scan-limit-is-rea-4aa8fec5 *

- Family: mcp-tooling
- Current fail_to_pass: `pnpm --filter @moltnet/mcp-server run test -- __tests__/profile-utils.test.ts`
- Why weak: Runs entire profile-utils.test.ts. The gold fix adds scan-limit warning (+82 lines) and new tests. Pre-existing tests pass.
- Proposed fix: `--grep "scan limit\|warning\|limit.*reached"` to target the new warning behavior tests.

### mcp-tooling-expose-identity-id-and-client-id-in-iden-262c731d *

- Family: mcp-tooling
- Current fail_to_pass: `pnpm --filter @moltnet/mcp-server run test -- __tests__/resources.test.ts`, `...e2e/mcp-server.e2e.test.ts`
- Why weak: Runs entire test files. The gold fix adds identity_id and client_id fields to resource (+13 lines). Pre-existing tests don't check for these new fields.
- Proposed fix: `--grep "identity_id\|client_id"` on resources.test.ts. Or rg probe: `rg -n 'identity_id.*client_id\|client_id.*identity_id' apps/mcp-server/src/resources.ts`.

### mcp-tooling-expose-identity-id-and-client-id-in-molt-bcf7dd69 *

- Family: mcp-tooling
- Current fail_to_pass: `pnpm --filter @moltnet/mcp-server run test -- __tests__/identity-tools.test.ts`, `...e2e/mcp-server.e2e.test.ts`
- Why weak: Runs entire test files. The gold fix adds identity_id and client_id to whoami tool (+9 lines). Pre-existing tests don't assert these fields.
- Proposed fix: `--grep "identity_id\|client_id"` on identity-tools.test.ts. Or rg probe: `rg -n 'identity_id' apps/mcp-server/src/identity-tools.ts`.

### mcp-tooling-remove-misleading-signing-payload-add-si-61ac8424 *

- Family: mcp-tooling
- Current fail_to_pass: `pnpm --filter @moltnet/mcp-server run test -- __tests__/crypto-tools.test.ts`, `...e2e/mcp-server.e2e.test.ts`
- Why weak: The gold fix removes signing_payload and adds sign_message prompt (+75/-17 lines). Pre-existing tests may not assert presence/absence of signing_payload field.
- Proposed fix: `--grep "sign_message\|signing_payload"` to target the renamed/removed tool tests. Or rg probe: `rg -n 'sign_message' apps/mcp-server/src/crypto-tools.ts`.

### mcp-tooling-task-10-overhaul-resources-with-getdiary-5fdb15bd

- Family: mcp-tooling
- Current fail_to_pass: `pnpm --filter @moltnet/mcp-server run test -- __tests__/resources.test.ts`, `.../__tests__/server.test.ts`
- Why weak: Runs entire test files. The gold fix overhauls resource URI patterns (+164/-91 lines). Pre-existing tests for old URI patterns still pass at fixture.
- Proposed fix: `--grep "getDiary\|new URI"` or rg probe on the new URI template: `rg -n 'moltnet://' apps/mcp-server/src/resources.ts`.

### mcp-tooling-adopt-entry-centric-tools-and-add-distil-acf0a592

- Family: mcp-tooling
- Current fail_to_pass: 4 test files
- Why weak: Massive change (+1684 lines) adding entry-centric tools and distill MCP tools. Pre-existing tests pass because old tool names still exist. New tools have new tests that are added in this commit.
- Proposed fix: `--grep "entries_create\|entries_update\|distill"` targeting the new entry-centric tool tests. Or rg probe: `rg -n 'entries_create\|entries_distill' apps/mcp-server/src/diary-tools.ts`.

### mcp-tooling-add-write-identity-prompt-and-fix-stale-f96b6ce5

- Family: mcp-tooling
- Current fail_to_pass: `pnpm --filter @moltnet/mcp-server run test -- __tests__/prompts.test.ts`, `...e2e/mcp-server.e2e.test.ts`
- Why weak: Runs entire test files. The gold fix adds write_identity prompt (+238 lines) and updates test expectations. Pre-existing prompt tests pass.
- Proposed fix: `--grep "write_identity"` to target only the new prompt tests.

### grp-mcp-tooling-add-e2e-tests-for-identity-bootstrap-flo-5daf5628

- Family: mcp-tooling
- Current fail_to_pass: `pnpm --filter @moltnet/mcp-server run test -- __tests__/diary-tools.test.ts`, `.../__tests__/identity-tools.test.ts`, `.../__tests__/resources.test.ts`, `...e2e/mcp-server.e2e.test.ts`
- Why weak: Runs 4 entire test files. Grouped task (2 commits). Adds identity bootstrap e2e tests and modifies tool schemas, prompts, resources. Pre-existing tests pass because old tool shapes and endpoints still exist at fixture.
- Proposed fix: `--grep "bootstrap\|identity.*prompt\|write_identity"` on the test files. Or use rg probe on new schema fields: `rg -n 'identityPrompt\|bootstrapFlow' apps/mcp-server/src/schemas.ts`.

### grp-mcp-tooling-assert-searchdiary-params-in-self-whoami-09c5b91f

- Family: mcp-tooling
- Current fail_to_pass: 4 test files (diary-tools, server, e2e, resources)
- Why weak: Runs 4 entire test files. Grouped task (4 commits). Adds searchDiary params assertion to self-whoami flow. Pre-existing tests pass without the assertion.
- Proposed fix: `--grep "searchDiary\|self.*whoami"` on diary-tools.test.ts.

### grp-mcp-tooling-regenerate-ts-and-go-api-clients-eb6bb81b

- Family: mcp-tooling
- Current fail_to_pass: 7 test files across mcp-server, rest-api, diary-service
- Why weak: Grouped task (3 commits). Regenerates API clients after schema changes. The regenerated types are backwards-compatible so all existing tests pass.
- Proposed fix: Use rg probe on specific new type names or fields in the generated types: `rg -n 'excludeTags\|ExcludeTagsParam' libs/api-client/src/generated/types.gen.ts`.

### grp-mcp-tooling-remove-duplicate-moltnet-observability-d-b51f74ec

- Family: mcp-tooling
- Current fail_to_pass: `rg -n 'serviceName' apps/mcp-server/src/main.ts`, `rg -n 'moltnet' apps/mcp-server/src/main.ts`, `rg -n 'serviceName' apps/rest-api/src/bootstrap.ts`
- Why weak: All 3 rg probes match at fixture. The probes search for `serviceName` and `moltnet` which already exist. The gold fix removes duplicate observability init, but the probed strings persist.
- Proposed fix: Use a more specific probe for the *absence* of the duplicate: `rg -c 'initSdk' apps/mcp-server/src/main.ts` expecting count=1, or `rg -n 'initSdk.*serviceName' apps/mcp-server/src/main.ts` and assert only 1 match.

### grp-mcp-tooling-remove-duplicated-entrytype-and-visibili-d1a23219

- Family: mcp-tooling
- Current fail_to_pass: `pnpm --filter @moltnet/mcp-server run test -- e2e/mcp-server.e2e.test.ts`
- Why weak: Runs entire e2e test. The gold fix removes duplicated enum re-exports and imports from models. E2e tests pass regardless because the runtime behavior is the same.
- Proposed fix: Use rg probe: `rg -n 'EntryType.*=.*enum\|Visibility.*=.*enum' apps/mcp-server/src/schemas.ts` expecting no matches after fix.

### grp-mcp-tooling-task-8-add-include-shared-to-diary-searc-a0e060a8

- Family: mcp-tooling
- Current fail_to_pass: 6 test files across rest-api, diary-service, mcp-server, database
- Why weak: Grouped task (3 commits). Adds includeShared param to diary search. Pre-existing tests don't use this param so they pass.
- Proposed fix: `--grep "includeShared\|shared"` on the relevant test files. Or rg probe: `rg -n 'includeShared' apps/mcp-server/src/diary-tools.ts`.

### grp-rest-api-route-add-consolidateresult-and-compileresult-6c9c3300

- Family: rest-api-route
- Current fail_to_pass: `pnpm --filter @moltnet/rest-api run test -- __tests__/diary.test.ts`
- Why weak: Runs entire diary.test.ts. Grouped task (4 commits). Adds ConsolidateResult and CompileResult types to diary routes. Pre-existing tests pass.
- Proposed fix: `--grep "consolidate\|compile\|ConsolidateResult\|CompileResult"` on diary.test.ts.

### grp-rest-api-route-drop-moltbook-name-and-email-make-public-31ad0b1d

- Family: rest-api-route
- Current fail_to_pass: 10 test files across rest-api, mcp-server, auth, database, models
- Why weak: Grouped task (4 commits). Massive schema change dropping moltbook name/email fields. Pre-existing tests pass because old fields still exist at fixture.
- Proposed fix: rg probe on absence of old fields: `rg -n 'moltbookName\|moltbookEmail' libs/database/src/schema.ts` expecting 0 matches. Or `--grep "publicKey\|drop.*name"` for the migration-related tests.

### grp-rest-api-route-regenerate-openapi-spec-and-client-for-m-a9295b46

- Family: rest-api-route
- Current fail_to_pass: 3 rg probes on diary.ts and types.ts
- Why weak: All 3 rg probes (`not_found`, `createProblem`, `DiaryService`) match at fixture. The probes target symbols that already exist before the fix.
- Proposed fix: Use tighter probe targeting the new code: `rg -n 'consolidateResult\|compileResult' apps/rest-api/src/routes/diary.ts` or target new type exports in types.ts.

### grp-rest-api-route-regenerate-types-with-signinginput-field-b9e34371

- Family: rest-api-route
- Current fail_to_pass: `pnpm --filter @moltnet/rest-api run test -- __tests__/signing-requests.test.ts`
- Why weak: Runs entire test file. Grouped task (3 commits). Regenerates types with SigningInput field. Pre-existing tests pass.
- Proposed fix: `--grep "SigningInput\|signingInput"` or rg probe: `rg -n 'SigningInput' libs/api-client/src/generated/types.gen.ts`.

### grp-rest-api-route-remove-500-allowance-from-concurrency-te-4663e0c3

- Family: rest-api-route
- Current fail_to_pass: 3 test files (vouch.test.ts, error-handler.test.ts, concurrency.e2e.test.ts)
- Why weak: Grouped task (4 commits). Removes 500 allowance from concurrency tests and changes error handler behavior. Pre-existing tests still pass.
- Proposed fix: `--grep "serialization\|retry\|500"` on error-handler.test.ts. Or use e2e selectors for concurrency test changes.

### grp-rest-api-route-show-api-url-and-manifest-form-url-in-te-1ac48301

- Family: rest-api-route
- Current fail_to_pass: 4 test files in legreffier-cli
- Why weak: Grouped task (4 commits). Adds API URL and manifest form URL display. Pre-existing tests pass.
- Proposed fix: `--grep "apiUrl\|manifestFormUrl\|API_URL"` on setup.test.ts and api.test.ts.

### grp-rest-api-route-update-mock-return-shapes-for-ory-client-4258c4ae

- Family: rest-api-route
- Current fail_to_pass: `pnpm --filter @moltnet/rest-api run test -- __tests__/recovery.test.ts`
- Why weak: Runs entire recovery.test.ts. Grouped task (2 commits). Updates mock return shapes for Ory client v2. Pre-existing tests pass because old mock shapes still work.
- Proposed fix: `--grep "createRecoveryCodeForIdentity\|Ory.*v2"` on recovery.test.ts.

### grp-service-logic-make-integration-tests-fail-hard-without-8560d526

- Family: service-logic
- Current fail_to_pass: 2 voucher test files
- Why weak: Grouped task (3 commits). Makes integration tests fail hard without DATABASE_URL. Pre-existing tests pass because DATABASE_URL skip logic already exists.
- Proposed fix: Use an rg probe: `rg -n 'fail.*hard\|throw.*DATABASE_URL' libs/database/__tests__/voucher.repository.integration.test.ts`.

### grp-service-logic-regenerate-clients-after-excludetags-upd-5256794c

- Family: service-logic
- Current fail_to_pass: 5 test files
- Why weak: Grouped task (4 commits). Regenerates clients after excludeTags feature. Pre-existing tests don't use excludeTags, so they pass.
- Proposed fix: `--grep "excludeTags\|exclude_tags"` on diary-tools.test.ts. Or rg probe: `rg -n 'excludeTags' apps/mcp-server/src/diary-tools.ts`.

### grp-service-logic-stamp-created-by-in-diary-entry-integrat-7330e849

- Family: service-logic
- Current fail_to_pass: 4 test files
- Why weak: Grouped task (2 commits). Stamps created_by in diary entry integration tests, adds schema + migration. Pre-existing tests don't check created_by.
- Proposed fix: `--grep "created_by\|createdBy"` across test files. Or rg probe: `rg -n 'createdBy\|created_by' libs/database/src/schema.ts`.

### grp-service-logic-update-tests-and-server-wiring-for-trans-47be4ae0

- Family: service-logic
- Current fail_to_pass: 2 diary-service test files
- Why weak: Grouped task (2 commits). Updates server wiring for transaction support. Pre-existing tests pass with old wiring.
- Proposed fix: `--grep "transaction\|transactionRunner"` on diary-service.test.ts.

### grp-sdk-package-add-connect-with-credential-resolution-5f024884

- Family: sdk-package
- Current fail_to_pass: 2 sdk test files (errors, register)
- Why weak: Grouped task (4 commits). Adds connect() with credential resolution. Pre-existing error and register tests pass.
- Proposed fix: `--grep "connect\|credential.*resolv"` on connect.test.ts (but that test file isn't in fail_to_pass). Better: switch verifier to `pnpm --filter @themoltnet/sdk run test -- __tests__/connect.test.ts`.

### grp-sdk-package-add-exportsshkey-function-07ba05e0

- Family: sdk-package
- Current fail_to_pass: `pnpm --filter @themoltnet/sdk run test -- __tests__/credentials.test.ts`
- Why weak: Grouped task (3 commits). Adds exportSshKey function. Verifier runs credentials.test.ts but the new function is in ssh.ts with tests in ssh.test.ts.
- Proposed fix: Switch verifier to `pnpm --filter @themoltnet/sdk run test -- __tests__/ssh.test.ts` and use `--grep "exportSshKey"`.

### grp-workflow-add-legreffier-public-endpoints-and-inst-d150eff6

- Family: workflow
- Current fail_to_pass: `pnpm --filter @moltnet/rest-api run test -- __tests__/config.test.ts`
- Why weak: Grouped task (4 commits). Adds LeGreffier public endpoints. Verifier only runs config.test.ts which tests config parsing - likely passes at fixture.
- Proposed fix: Switch to test the new workflow: `pnpm --filter @moltnet/rest-api run test -- __tests__/workflows/legreffier-onboarding-workflow.test.ts`.

### grp-workflow-extend-diary-management-and-refresh-open-3b0e8fce

- Family: workflow
- Current fail_to_pass: `pnpm --filter @moltnet/rest-api run test -- e2e/diary-management.e2e.test.ts`
- Why weak: Grouped task (4 commits). Extends diary management e2e. Pre-existing e2e tests pass.
- Proposed fix: `--grep "refresh\|extend"` on diary-management.e2e.test.ts.

### grp-workflow-regenerate-openapi-spec-with-consolidate-a435b778

- Family: workflow
- Current fail_to_pass: `pnpm --filter @moltnet/rest-api run test -- __tests__/diary-distill.test.ts`
- Why weak: Grouped task (4 commits). Adds consolidation workflow code. Pre-existing distill tests pass.
- Proposed fix: `--grep "consolidat"` on diary-distill.test.ts.

### workflow-pass-query-embedding-into-searchentriess-306ba065

- Family: workflow
- Current fail_to_pass: `pnpm --filter @moltnet/rest-api run test -- e2e/diary-distill.e2e.test.ts`
- Why weak: Runs entire e2e test. The gold fix adds query+embedding pass-through (+217 lines) and new tests. Pre-existing e2e tests pass.
- Proposed fix: `--grep "query.*embedding\|searchEntriesStep"` on diary-distill.e2e.test.ts. Or use the unit test instead: `pnpm --filter @moltnet/rest-api run test -- __tests__/workflows/context-distill-workflows.test.ts --grep "searchEntries"`.

---

## stale_fixture (16 tasks)

Tasks where the fixture commit is positioned before intermediate commits that already introduce the tested behavior. Could recover by retrying with a wider commit group or adjusting the fixture to a true pre-feature state.

### grp-rest-api-route-register-error-handler-plugin-and-update-bc656c8f

- Family: rest-api-route
- Current fail_to_pass: `pnpm --filter @moltnet/rest-api run test` (full suite)
- Why stale: Grouped task (4 commits). The fixture at 40d2773f is already 4 commits behind the gold fix. Intermediate commits likely added the error-handler plugin that the final commit references. Running the full test suite at fixture passes because the plugin isn't registered yet (so no new tests exist to fail).
- Recovery strategy: Retry as grouped task with fixture set to before the first error-handler commit. Or use rg probe: `rg -n 'errorHandler.*plugin\|registerErrorHandler' apps/rest-api/src/app.ts`.

### grp-rest-api-route-resolve-all-typescript-type-check-errors-0c849ddf

- Family: rest-api-route
- Current fail_to_pass: `pnpm --filter @moltnet/rest-api run test` (full suite)
- Why stale: Grouped task (2 commits). The fix resolves TypeScript type-check errors across 10 route files. No test file changes. Running the full test suite passes because type errors don't cause runtime test failures.
- Recovery strategy: Switch fail_to_pass to typecheck: `pnpm --filter @moltnet/rest-api run typecheck`. But this was likely already in pass_to_pass. Not easily recoverable.

### grp-rest-api-route-embed-manifest-via-js-string-literal-to-ba673b28

- Family: rest-api-route
- Current fail_to_pass: `pnpm --filter @moltnet/rest-api run test` (full suite)
- Why stale: Grouped task (2 commits). Changes security headers and public routes to embed manifest. No test changes. Tests pass because the behavioral change (CSP header modification) isn't asserted.
- Recovery strategy: Use rg probe: `rg -n 'string.*literal\|manifest.*embed' apps/rest-api/src/routes/public.ts` targeting the new embedding code.

### grp-rest-api-route-expose-memory-system-fields-on-diary-end-7253d78c

- Family: rest-api-route
- Current fail_to_pass: `pnpm --filter @moltnet/rest-api run test` (full suite)
- Why stale: Grouped task (2 commits). Exposes memory system fields on diary endpoint. No test changes. Tests pass because new fields are additive.
- Recovery strategy: rg probe: `rg -n 'memorySystem\|memory_system' apps/rest-api/src/schemas.ts`.

### grp-service-logic-add-listacceptedforagent-to-diarysharere-fd4acdb7

- Family: service-logic
- Current fail_to_pass: `pnpm --filter @moltnet/database run test` (full suite)
- Why stale: Grouped task (3 commits). Adds listAcceptedForAgent to diary share repository + new SQL migration. No test file changes. Full database test suite passes at fixture.
- Recovery strategy: Use rg probe: `rg -n 'listAcceptedForAgent' libs/database/src/repositories/diary-share.repository.ts`.

### grp-service-logic-use-getexecutor-db-in-agent-and-voucher-933fedf6

- Family: service-logic
- Current fail_to_pass: `pnpm --filter @moltnet/database run test` (full suite)
- Why stale: Grouped task (2 commits). Switches to getExecutor() in repositories. No test changes. Tests pass because the runtime behavior is equivalent.
- Recovery strategy: rg probe: `rg -n 'getExecutor' libs/database/src/repositories/agent.repository.ts` targeting the new pattern.

### grp-mcp-tooling-add-mcp-auth-proxy-to-dockerfile-copy-e044a272

- Family: mcp-tooling
- Current fail_to_pass: `pnpm --filter @moltnet/mcp-server run test` (full suite)
- Why stale: Grouped task (2 commits). Adds config and Dockerfile changes. No test changes. Tests pass at fixture.
- Recovery strategy: rg probe on config: `rg -n 'authProxy\|MCP_AUTH_PROXY' apps/mcp-server/src/config.ts`.

### grp-mcp-tooling-align-fly-toml-metrics-dataset-env-var-n-426e3ced

- Family: mcp-tooling
- Current fail_to_pass: `pnpm --filter @moltnet/mcp-server run test` (full suite)
- Why stale: Grouped task (2 commits). Aligns fly.toml env vars and config. No test changes. Tests pass at fixture.
- Recovery strategy: rg probe: `rg -n 'METRICS_DATASET\|metricsDataset' apps/mcp-server/src/config.ts`.

### mcp-tooling-add-null-guard-and-fix-journal-path-refs-5b417594

- Family: mcp-tooling
- Current fail_to_pass: `pnpm --filter @moltnet/mcp-server run test` (full suite)
- Why stale: Single commit, but the fix is a null guard (+6/-2 lines) in info-tools.ts. The test suite doesn't exercise the null path that would fail. Tests pass with or without the guard.
- Recovery strategy: Add a specific test or rg probe: `rg -n 'null.*guard\|??\|optional.*chain' apps/mcp-server/src/info-tools.ts`. Low recovery value.

### mcp-tooling-bump-getlarge-fastify-mcp-to-1-3-0-getla-2635f4ea

- Family: mcp-tooling
- Current fail_to_pass: `pnpm --filter @moltnet/mcp-server run test` (full suite)
- Why stale: Single commit bumping dependency version. No test changes. Tests pass because the old version also works. Dependency version changes are inherently not task-shaped for behavioral testing.
- Recovery strategy: Not easily recoverable. Would need a probe that checks package.json version.

### mcp-tooling-clarify-crypto-prepare-signature-guidanc-aa16ae1f

- Family: mcp-tooling
- Current fail_to_pass: `pnpm --filter @moltnet/mcp-server run test` (full suite)
- Why stale: Single commit changing 5 lines of tool description text. No test changes. Tests pass because description changes don't affect test assertions.
- Recovery strategy: rg probe: `rg -n 'signBytes' apps/mcp-server/src/crypto-tools.ts` targeting the new guidance text.

### mcp-tooling-correctly-extract-access-token-389696df

- Family: mcp-tooling
- Current fail_to_pass: `pnpm --filter @moltnet/mcp-server run test` (full suite)
- Why stale: Single commit fixing token extraction (+11/-3 in utils.ts). The test helper is modified but the full test suite doesn't exercise the broken extraction path.
- Recovery strategy: rg probe: `rg -n 'extractAccessToken\|Bearer' apps/mcp-server/src/utils.ts` or use the specific test helper that changed.

### grp-workflow-use-compose-disable-env-file-true-to-pre-f25a2b44

- Family: workflow
- Current fail_to_pass: 3 rg probes on bootstrap.ts and diary-distill.ts
- Why stale: Grouped task (4 commits). The rg probes match at fixture because the symbols (`setContextDistillDeps`, `diaryEntryRepository`, `updatedAt`) already exist.
- Recovery strategy: Use tighter probes targeting specific patterns introduced by the gold fix, not generic symbol names.

### grp-observability-add-undici-instrumentation-for-distribut-9d62e171

- Family: observability
- Current fail_to_pass: `pnpm --filter @moltnet/observability run test -- __tests__/sdk.test.ts`
- Why stale: Grouped task (2 commits). Adds undici instrumentation. Pre-existing sdk.test.ts passes.
- Recovery strategy: `--grep "undici\|UndiciInstrumentation"` on sdk.test.ts.

### grp-observability-remove-otel-context-from-mixin-defer-to-b2519da2

- Family: observability
- Current fail_to_pass: `pnpm --filter @moltnet/observability run test -- __tests__/request-context.test.ts`
- Why stale: Grouped task (3 commits). Removes OTel context from mixin. Pre-existing request-context tests pass.
- Recovery strategy: `--grep "otel\|context.*mixin"` or rg probe on removed import.

### grp-observability-rename-axiom-api-key-to-axiom-api-token-2392275a

- Family: observability
- Current fail_to_pass: `pnpm --filter @moltnet/observability run test -- __tests__/fastify-plugin.test.ts`
- Why stale: Grouped task (3 commits). Renames env var. Pre-existing tests pass with old name.
- Recovery strategy: rg probe: `rg -n 'AXIOM_API_TOKEN' libs/observability/src/sdk.ts` (new name won't exist at fixture if fixture uses old name).

---

## not_task_shaped (23 tasks)

Genuinely unrecoverable. The gold fix only modifies test files (no source changes), only changes docs/config, the behavioral change is untestable (comment-only, type-only, removal-only), or the verifier runs full suite against source changes with no new tests.

### auth-permissions-remove-grantviewer-from-relationshipwrit-02286ae5

- Family: auth-permissions
- Why unrecoverable: Gold fix is pure deletion (-30 lines, +0 lines). Removes `grantViewer` from RelationshipWriter and removes its tests. At fixture the tests exist and pass (testing the function that will be removed). Cannot create a failing test for "this function should not exist."

### grp-auth-permissions-resolve-audit-vulnerability-and-lint-err-745d4bea

- Family: auth-permissions
- Why unrecoverable: Grouped task resolving audit vulnerability + lint errors. Changed files include package.json, pnpm-lock.yaml, journal docs. The "fix" is a dependency update + lint cleanup. Test at fixture passes because token-validator.test.ts tests existing behavior.

### grp-cli-package-add-npm-wrapper-package-for-binary-distr-6e9ef127

- Family: cli-package
- Why unrecoverable: Adds npm wrapper package files (bin/moltnet.js, install.js). The test is `pnpm --filter @themoltnet/cli run test` which runs the full CLI test suite. The wrapper files are new additions that don't break existing tests. Not behavior-testable through unit tests.

### grp-infra-or-e2e-expand-public-feed-search-corpus-to-matc-b17ce47d

- Family: infra-or-e2e
- Why unrecoverable: Gold fix only modifies test files and CI config. No source code changes. Changes are in e2e test corpus/setup. Tests pass at fixture because the test file is self-contained.

### grp-infra-or-e2e-fix-mcp-e2e-tests-and-add-public-feed-mc-56b520bd

- Family: infra-or-e2e
- Why unrecoverable: Gold fix only modifies test files (e2e tests) and CI config. No source code changes. E2e test fixes are self-referential.

### grp-infra-or-e2e-forward-retryafter-through-error-handler-ca4b053b

- Family: infra-or-e2e
- Why unrecoverable: Changes rate-limit and error-handler plugins, but only test file is an e2e test. Grouped task (3 commits). The e2e test at fixture passes because the retry-after behavior is only observable in production-like conditions.

### grp-infra-or-e2e-add-get-public-feed-search-endpoint-e0367a2d

- Family: infra-or-e2e
- Why unrecoverable: Large task adding public feed search endpoint. While it has source changes, the verifier runs signing-requests.test.ts which is unrelated to the public feed search feature. The test file was modified only for helper changes.

### grp-infra-or-e2e-centralize-all-config-in-moltnet-directo-c4ced243

- Family: infra-or-e2e
- Why unrecoverable: Grouped task centralizing config. Source changes across many files. But the verifier runs legreffier-cli tests (github.test.ts, state.test.ts) which test CLI state management - they pass at fixture because the config centralization doesn't break the test contract.

### infra-or-e2e-add-e2e-happy-path-for-legreffier-onboar-024fe9da

- Family: infra-or-e2e
- Why unrecoverable: Gold fix adds a new e2e test file (+320 lines). The test references legreffier-onboarding.e2e.test.ts which is a new file. At fixture, this file likely doesn't exist yet, so the test command may succeed vacuously (no matching tests = pass).

### infra-or-e2e-avoid-js-injection-in-audit-comment-step-95805b21

- Family: infra-or-e2e
- Why unrecoverable: Gold fix only changes CI workflow YAML. rg probes for `exit_code`/`exitCode` match at fixture because these strings already exist in the workflow file. The fix changes how they're used (JS injection prevention) but rg presence-checks can't distinguish safe vs unsafe usage.

### infra-or-e2e-move-docker-compose-lifecycle-to-ci-runn-6854d72a

- Family: infra-or-e2e
- Why unrecoverable: rg probes for `hybrid_search`/`diary_search` in SQL migration file match at fixture. The SQL migration exists before the fix. The fix moves Docker Compose lifecycle which is a CI-only change.

### service-logic-add-missing-logger-to-integration-test-f-f037bccf

- Family: service-logic
- Why unrecoverable: Gold fix only modifies test files (adds missing logger to test fixtures). No source code changes. Tests pass at fixture because the logger was optional or had a default.

### service-logic-fix-dbos-workflow-registration-order-in-e1a084a7

- Family: service-logic
- Why unrecoverable: Gold fix only modifies test files (+178/-111 lines across 5 test files, plus package.json). No source code changes. The test restructuring doesn't introduce new failing behavior.

### service-logic-integrate-injectionrisk-field-and-regene-3a110cd5

- Family: service-logic
- Why unrecoverable: rg probes for `injectionRisk`/`injection_risk` in diary.repository.ts match at fixture (confirmed: 5 matches). The field already exists in the repository at the fixture commit. The fix only adds 5 lines of incremental integration code.

### sdk-package-add-entry-centric-entry-routes-and-disti-2e936224

- Family: sdk-package
- Why unrecoverable: Massive change (+6682 lines) adding entry-centric routes. While there are source changes, the test files (diary-entries.test.ts, diary-crud.e2e.test.ts, agent.test.ts) are rewritten wholesale. At fixture, the old tests exist and pass because they test the old routes.

### sdk-package-default-output-paths-relative-to-config-c6b5ced3

- Family: sdk-package
- Why unrecoverable: Changes are mainly in Go code (credentials.go, git.go, ssh.go). The TypeScript SDK test (`pnpm --filter @themoltnet/sdk run test`) runs the TS test suite which doesn't cover the Go path changes. The ssh.ts change is a default path tweak that doesn't break existing tests.

### sdk-package-split-agent-facade-by-namespace-and-simp-a664de84

- Family: sdk-package
- Why unrecoverable: Major refactor (+670/-752 lines) splitting agent facade into namespaces. The test file (agent.test.ts) is rewritten to match new structure. At fixture, old agent.test.ts tests old monolithic agent and passes.

### sdk-package-use-entry-centric-update-type-import-3db76197

- Family: sdk-package
- Why unrecoverable: 2-line import path change. `pnpm --filter @themoltnet/sdk run test` runs full suite. The import change is invisible to runtime tests (same type, different import path).

### sdk-package-use-vite-plugin-dts-to-bundle-d-ts-decla-2e238b9b

- Family: sdk-package
- Why unrecoverable: Changes vite.config.ts to use vite-plugin-dts. This is a build config change, not testable via unit tests. Test suite passes regardless.

### rest-api-route-clarify-transaction-comment-in-hooks-han-8eed5405

- Family: rest-api-route
- Why unrecoverable: Already listed in stale_fixture but should be here: gold fix only changes a code comment (+4/-3 lines). No behavioral change whatsoever. No test can distinguish before/after.

### rest-api-route-harden-recovery-flow-with-anti-enumerati-250eac29

- Family: rest-api-route (borderline - moved from stale to not_task_shaped)
- Why unrecoverable: Adds anti-enumeration protection but no new test file. The fix adds NonceRepository dependency and nonce checks, but existing recovery tests don't exercise these paths. Without new tests in the gold fix, there's nothing to fail.

### rest-api-route-resolve-webhook-route-registration-issue-228cca75

- Family: rest-api-route (borderline)
- Why unrecoverable: Fixes route registration order. The issue only manifests in real Fastify lifecycle, not in unit tests that mock the server. No new tests added.

### rest-api-route-wrap-dbos-getstatus-in-try-catch-on-onbo-81a31106

- Family: rest-api-route
- Why unrecoverable: Adds error handling around DBOS.getStatus(). No new tests. The error path is not exercised by existing tests.

---

## Recovery Priority List

The following 15 tasks are the most promising for recovery, all in priority families:

| # | Task ID | Family | Strategy |
|---|---------|--------|----------|
| 1 | service-logic-enforce-immutability-on-all-signed-field-b0af30df | service-logic | `--grep "immutab\|nonce"` on diary-service.test.ts |
| 2 | service-logic-keto-first-listdiaries-creatediary-compe-432fe47c | service-logic | `--grep "Keto\|compensation"` on diary-service tests |
| 3 | service-logic-move-dbos-workflow-scheduling-inside-tra-5500c799 | service-logic | `--grep "transaction\|atomicity"` on diary-service.test.ts |
| 4 | service-logic-add-diaryrepository-listbyids-bc311153 | service-logic | `--grep "listByIds"` on diary.repository.integration.test.ts |
| 5 | service-logic-add-issueunlimited-to-voucherrepository-137b9201 | service-logic | `--grep "issueUnlimited"` on voucher.repository.test.ts |
| 6 | service-logic-add-structured-logging-for-business-oper-a2502cd3 | service-logic | `--grep "logger"` on diary-service.test.ts |
| 7 | mcp-tooling-expose-identity-id-and-client-id-in-iden-262c731d | mcp-tooling | `--grep "identity_id\|client_id"` on resources.test.ts |
| 8 | mcp-tooling-expose-identity-id-and-client-id-in-molt-bcf7dd69 | mcp-tooling | `--grep "identity_id\|client_id"` on identity-tools.test.ts |
| 9 | mcp-tooling-remove-misleading-signing-payload-add-si-61ac8424 | mcp-tooling | `--grep "sign_message"` on crypto-tools.test.ts |
| 10 | mcp-tooling-warn-when-system-entry-scan-limit-is-rea-4aa8fec5 | mcp-tooling | `--grep "scan limit\|warning"` on profile-utils.test.ts |
| 11 | rest-api-route-validate-tags-query-param-length-and-cou-56e6a505 | rest-api-route | `--grep "tag.*length\|tag.*count"` on diary.test.ts |
| 12 | rest-api-route-return-same-error-for-unknown-key-and-ba-4a919e83 | rest-api-route | `--grep "unknown key\|same error"` on recovery.test.ts |
| 13 | rest-api-route-add-route-specific-rate-limiting-to-publ-79ec8791 | rest-api-route | rg probe: `rg -n 'routeRateLimit' apps/rest-api/src/plugins/rate-limit.ts` |
| 14 | grp-rest-api-route-add-consolidateresult-and-compileresult-6c9c3300 | rest-api-route | `--grep "consolidate\|compile"` on diary.test.ts |
| 15 | grp-service-logic-regenerate-clients-after-excludetags-upd-5256794c | service-logic | `--grep "excludeTags"` on diary-tools.test.ts |
