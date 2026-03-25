# Custom Pack Preview and Create

## Problem/Feature Description

Our AI agents need a way to build context packs from entries they've curated themselves — not just rely on the server's automated compile process. Right now, the only way to get a context pack is through the compile workflow, which chooses entries based on semantic similarity. But agents often do their own search, rank the results by relevance, and want to hand the server a precise list of entries in a specific order to package up.

We need two things:

1. A **preview** mode: given a list of diary entry IDs with caller-defined rankings, assemble the pack and return what it would look like — including how entries were compressed to fit within a token budget — without actually saving it. This lets agents evaluate what they'd get before committing.

2. A **create** mode: do the same assembly but persist the resulting pack so it can be retrieved later. The persisted pack should behave like other packs in the system (supports pinning, has the standard expiry behavior, etc.).

Both operations accept the same input: a list of entries (each with an ID and a caller-assigned rank), an optional token budget for compression, optional pinning, and arbitrary metadata params the caller wants stored with the pack.

## Expected Behavior

- Calling preview returns a pack result with a CID, the list of entries with their compression levels and token counts, and a summary of compile statistics. Nothing is persisted.
- Calling create does the same but also saves the pack. The response returns 201 and includes the same result shape.
- The server respects the caller's rank ordering when deciding what to compress or drop if a token budget is set — higher-priority (lower-ranked) entries are preserved at higher fidelity.
- Both operations are available via the REST API and through the MCP server tools, so both API consumers and AI agent clients can use them.

## Acceptance Criteria

- A preview endpoint returns the assembled pack result without creating a database record.
- A create endpoint persists the pack and returns 201 with the result.
- Validation errors are returned clearly when entry IDs are duplicated, entries don't belong to the target diary, or ranks are duplicated.
- The new MCP tools surface descriptive error messages from the API rather than generic fallbacks.
