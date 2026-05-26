---
name: rendered-pack-bba8dca4
description: >
  Use when writing or reviewing MoltNet e2e tests (apps/*/e2e,
  libs/mcp-test-harness): use @moltnet/api-client (createClient + typed fns
  like createDiaryEntry) not raw fetch for in-spec endpoints. Raw fetch only
  for /health, /oauth2/token, /auth/register.
moltnet:
  rendered_pack_id: bba8dca4-c029-42ad-a43d-5d28fec0fdc3
  rendered_pack_cid: bafyreig6xgdiw6hsehuafjv3vr54gprbqvqedmm36ey3rp3pthksduzati
  source_pack_id: 141fdb3d-eec9-427d-89f8-6171fbd3e0cc
  bundled_at: 2026-05-24T17:36:03Z
---

# Context Pack 141fdb3d-eec9-427d-89f8-6171fbd3e0cc

- Created: 2026-05-24T17:31:34.460Z
- Entries: 4

### Decision: enforce api-client usage in e2e dedup tests

- Entry ID: `7b0a6488-6609-4a1f-8a97-8a117cd7969d`
- CID: `bafkreihztuh4jkjl2t55bfl5surlotmvrveyw5ujuznqwgxeebkfy4w4ri`
- Compression: `full`
- Tokens: 131/131

Decision: Add explicit eval criteria requiring `@moltnet/api-client` helpers (not raw `fetch`) for authenticated duplicate/invalidation e2e coverage.
Alternatives considered: Keep tests as raw HTTP `fetch` calls for simplicity.
Reason chosen: API-client usage keeps tests aligned with repo conventions, typed request/response shapes, and auth helper reuse. It also avoids criterion ambiguity around transport details.
Trade-offs: Slightly more ceremony in concurrent status assertions (`response.status` fields), but higher consistency and maintainability.
Context: User review explicitly requested criteria entries for avoiding fetch in these e2e tests.

<metadata>
operator: edouard
tool: codex
refs: apps/rest-api/e2e/diary-distill.e2e.test.ts, evals/add-dbos-dedup-queues/criteria.json, libs/api-client/
timestamp: 2026-03-09T00:00:00Z
branch: feat/issue-378-eval-runner
scope: scope:evals, scope:rest-api
</metadata>

### Incident: raw fetch in e2e tests despite api-client having the endpoints

- Entry ID: `24e3532a-753f-4767-989d-c49bb1c0b16c`
- CID: `bafkreih3bnpgudnk6l4rjrs3ov6iwhis2v7ts42mm5p34g5sgribyihb64`
- Compression: `full`
- Tokens: 80/80

Wrote team-governance.e2e.test.ts using raw fetch() for all governance endpoints instead of @moltnet/api-client. Test was written before OpenAPI regen, not updated after. All endpoints (initiateTransfer, acceptTransfer, rejectTransfer, listPendingTransfers, acceptTeamFounding, createTeam) were in sdk.gen.ts after regeneration. Fix: rewrite to use client functions. Rule: e2e tests must use api-client for any endpoint in the generated spec; raw fetch only for /health, /oauth2/token, /auth/register.

### Recurrence: raw fetch in mcp-host-e2e + mcp-test-harness instead of api-client

- Entry ID: `cbdd365c-b319-4390-8f64-9a59920af2ab`
- CID: `bafkreicwgdd7scrllup2hqjh3aj43rrmpzsw754kbv6jq4brqqsrfl6bi4`
- Compression: `full`
- Tokens: 347/347

What happened: apps/mcp-host-e2e/src/entry-map.spec.ts (added in PR #1229) seeds diary entries with a raw fetch() to POST /diaries/:id/entries instead of the generated @moltnet/api-client (createClient + createDiaryEntry). The shared libs/mcp-test-harness/src/harness.ts does the same for POST /diaries (createDiary). This re-introduces the exact anti-pattern previously documented and ruled against.

Root cause: the new spec followed the harness's existing raw-fetch seeding style rather than the repo convention. The sibling suites apps/rest-api/e2e/_.e2e.test.ts and apps/mcp-server/e2e/_.e2e.test.ts already do this correctly (import createClient + createDiaryEntry from @moltnet/api-client). POST /diaries/:id/entries and POST /diaries ARE in the generated SDK, so per the established rule they must NOT use raw fetch.

The rule (from incident 24e3532a): e2e tests must use api-client for any endpoint in the generated spec; raw fetch is allowed ONLY for /health, /oauth2/token, /auth/register. Decision 7b0a6488 enforces api-client usage in e2e coverage. Both endpoints here are in-spec, so both violate it.

Fix: NOT done in PR #1229 (user explicitly deferred to avoid scope creep). Tracked for the next PR: refactor entry-map.spec.ts seeding to createDiaryEntry, and the mcp-test-harness public-diary creation to createDiary, both via createClient({ baseUrl: restApiUrl }) with the bearer + x-moltnet-team-id headers. Note the harness fix benefits every MCP e2e suite, so it is the higher-leverage one.

Watch for: when writing or copying e2e setup/seeding, use @moltnet/api-client for any in-spec endpoint; only /health, /oauth2/token, /auth/register may use raw fetch. The mcp-test-harness raw-fetch seeding is a tempting template that propagates the anti-pattern — fix it at the source.

<metadata>
operator: edouard | tool: claude | timestamp: 2026-05-24T17:28:10Z
branch: issue-1194-diary-map-app | scope: testing,mcp-apps | refs: apps/mcp-host-e2e/src/entry-map.spec.ts, libs/mcp-test-harness/src/harness.ts, @moltnet/api-client, createDiaryEntry
</metadata>

### Accountable commit: Replace raw fetch() calls in e2e test with @moltnet/api-client functions.

- Entry ID: `73ac8b20-f36b-46ef-803f-8204fba12fc4`
- CID: `bafkreigebb2uu65tkt43detaiolbjkqj2riivtxxwlncnvlo6wtxgu6jhm`
- Compression: `full`
- Tokens: 110/110

<content>
Replace raw fetch() calls in e2e test with @moltnet/api-client functions. All governance endpoints (createTeam with foundingMembers, acceptTeamFounding, initiateTransfer, listPendingTransfers, acceptTransfer, rejectTransfer) were already in the generated SDK after OpenAPI regen. Two fetch calls remain for GET /diaries/:id to read teamId — the generated getDiary response type does not expose teamId, making raw fetch the correct choice for those assertions.
</content>
<metadata>
signer: 1671-B080-99BF-4270
operator: edouard
tool: claude
risk-level: low
files-changed: 1
refs: apps/rest-api/e2e/team-governance.e2e.test.ts
timestamp: 2026-04-07T17:50:30Z
branch: feat/team-governance-workflows
scope: test, governance
</metadata>
