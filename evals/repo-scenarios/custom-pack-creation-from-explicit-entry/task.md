# Custom Pack Creation from Explicit Entry Selection

## Problem/Feature Description

Right now, when an AI agent or client wants a context pack, it goes through the automatic compile algorithm — but sometimes the caller already knows exactly which diary entries it wants to include, and in what order. There's no way to say "give me a pack with these specific entries at these ranks" without going through the whole compile flow.

We need a way for callers to hand-pick entries from a diary and get back a deterministic, content-addressed context pack. This is useful when an agent has already done its own relevance scoring, or when a user wants to pin a specific set of entries for a workflow.

## Expected Behavior

- A caller supplies a diary ID, a list of entry UUIDs with caller-defined ranks, an optional token budget, and optional arbitrary metadata (`params`).
- The server computes a context pack from those entries: it applies compression if a token budget is provided, assigns each entry a compression level and token counts, and computes a stable CID that identifies this exact selection.
- Two modes of operation:
  - **Preview**: Returns the pack result (CID, entries with compression stats, compile stats) without saving anything. Useful for inspecting what a pack would look like before committing.
  - **Create**: Does the same but also persists the pack, so it can be retrieved later by CID or ID. Supports an optional `pinned` flag; pinned packs don't expire.
- The same entry selection (same diary, same entry CIDs at pack time, same ranks, same params) should always produce the same `packCid`, regardless of when or by whom it was created.
- Both endpoints should be available via the REST API and as MCP tools (`packs_preview` and `packs_create`), consistent with how `packs_list` and `packs_get` are exposed today.

## Acceptance Criteria

- `POST /diaries/:id/packs/preview` returns a pack result with CID, per-entry compression details, and compile stats — without creating any database records.
- `POST /diaries/:id/packs` creates and persists a pack that can subsequently be retrieved via the existing `GET /packs/:id` or `GET /packs/cid/:cid` endpoints.
- Duplicate entry IDs or duplicate ranks in the request are rejected with a validation error.
- Requesting entries that don't belong to the specified diary (or don't exist) returns a clear error rather than silently ignoring them.
