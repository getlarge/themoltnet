---
date: '2026-02-18T13:00:00Z'
author: claude-sonnet-4-6
session: sdk-diary-types-drift-fix
type: decision
importance: 0.6
tags: [sdk, ws9, api-client, types, drift]
supersedes: null
signature: <pending>
---

# SDK namespace interfaces now derived from api-client Data types

## Context

After syncing main (which included the diary tags filter from #213 and the SDK
connect/agent facade from the sdk-connect-token-management session), the
`DiaryNamespace` interface in `libs/sdk/src/agent.ts` was hand-writing its own
parameter types — duplicating what the generated api-client already knows. This
caused `diary.list()` and `diary.search()` to be missing the `tags` filter
parameter that the API supports.

## Substance

All hand-written parameter types in the namespace interfaces have been replaced
with types derived directly from the api-client's generated `*Data` types:

- `diary.list(query?)` → `ListDiaryEntriesData['query']` (gains `tags?: string`)
- `diary.search(body?)` → `SearchDiaryData['body']` (gains `tags?: Array<string>`)
- `diary.create(body)` → `NonNullable<CreateDiaryEntryData['body']>`
- `diary.update(id, body)` → `NonNullable<UpdateDiaryEntryData['body']>`
- `diary.share(id, body)` → `NonNullable<ShareDiaryEntryData['body']>`
- `diary.reflect(query?)` → `ReflectDiaryData['query']`
- `diary.sharedWithMe(query?)` → `GetSharedWithMeData['query']`
- `diary.setVisibility(id, body)` → `NonNullable<SetDiaryEntryVisibilityData['body']>`
- `signingRequests.list(query?)` → `ListSigningRequestsData['query']`
- `vouch.trustGraph(query?)` → `GetTrustGraphData['query']`
- `public.feed(query?)` → `GetPublicFeedData['query']`
- `public.searchFeed(query)` → `NonNullable<SearchPublicFeedData['query']>`

The `Visibility` union literal import was removed as it is no longer referenced
directly (it flows through the derived types instead).

## Continuity Notes

- Branch `claude/sdk-diary-types-from-api-client`, single commit on top of main
- lint, typecheck, and all 98 tests pass
- The pattern to follow: whenever a new endpoint is added to the API and the
  api-client is regenerated, the SDK namespace interface updates automatically —
  no manual sync needed
- `AgentsNamespace` methods (`whoami`, `verifySignature`) still use inline types
  because the response shapes there are hand-written too and would need the same
  treatment separately
