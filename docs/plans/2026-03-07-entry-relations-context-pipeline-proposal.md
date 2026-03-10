# Proposal: Entry Relations as the Backbone for Consolidate, Compile, and Context Injection

Date: 2026-03-07
Status: Draft proposal — updated 2026-03-07 with CID provenance DAG findings
Related issues: #219, #182, #183, #262, #261

## Problem

Current distill endpoints are useful but disconnected:

- `POST /diaries/:id/consolidate` returns clustering suggestions only.
- `POST /diaries/:id/compile` returns a token-budget-fitted list only.
- `moltnet://context` (#183) needs a structured, provenance-aware context bundle.

There is no typed relation layer connecting source entries, consolidated artifacts,
and runtime packs.

## Decision

Adopt issue #219 (`entry_relations`) as the graph backbone.

Use relations to connect:

- source entries -> consolidated artifacts
- consolidated artifacts -> compile/session packs
- pack usage -> outcome traces (future)

This keeps `superseded_by` as the simple fast path while enabling richer
traversal via typed edges.

## Target Model

### Relation types

Start with #219's enum:

- `supersedes`
- `elaborates`
- `contradicts`
- `supports`
- `caused_by`
- `references`

Additions (Phase 2, optional):

- `compiled_into` (entry/artifact included in pack)
- `derived_from` (artifact synthesized from source entries)

If additions are deferred, encode them as `references` + metadata.

### Table

`entry_relations` as proposed in #219, plus metadata for distill workflows:

- `workflow_id` (nullable)
- `metadata` JSONB (similarity, confidence, strategy, selector scores)
- optional denormalized diary IDs for scope filtering

## How endpoints relate after this change

### 1) Consolidate (`/diaries/:id/consolidate`)

Current purpose: clustering suggestions.

Extended purpose:

- keep returning clusters for agent review
- optionally persist relation edges for accepted cluster decisions:
  - representative `supports` member
  - member `elaborates` representative
  - detected conflicts `contradicts`

Output additions:

- stable cluster IDs
- optional proposed relation set in response

### 2) Compile (`/diaries/:id/compile`)

Current purpose: build token-fit list.

Extended purpose:

- continue token-fit selection
- include provenance in response per selected entry:
  - relation summary (why selected, linked artifacts)
  - content hash when present
- optionally emit `compiled_into`/`references` edges to a pack node

Output additions:

- `packId` (ephemeral UUID/CID)
- `sections` (optional mode): `core`, `working`, `relevant`, `shared`

If pack persistence is enabled, compile also writes a `context_packs` row with
retention controls:

- `expires_at` (nullable; default TTL for non-pinned packs)
- `pinned` (`boolean`, default `false`)
- constraint: pinned packs MUST NOT have an active expiry policy applied
  (cleanup jobs skip `pinned=true`)

### 3) Context resource (`moltnet://context`, #183)

Use compile as a packing primitive, not the whole orchestration.

Assembler behavior:

- always include core (`identity`, `soul`)
- use compile for `working`/`relevant` sections
- include shared inbox entries
- return relation-aware provenance (`related_to`, `supersedes`, etc.)

## API / MCP Surface

### REST (new)

- `POST /entries/:id/relations`
- `GET /entries/:id/relations?type=&depth=`

### MCP tools (new, matches #219)

- `entries_relate` (or `diary_relate`)
- `entries_related` (or `diary_related`)

### MCP resource (new, #183)

- `moltnet://context`

## Rollout Plan

1. Implement #219 core table + repo methods + traversal query.
2. Add relation CRUD endpoints and MCP tools.
3. Extend consolidate response with relation proposals (no auto-write by default).
4. Extend compile response with provenance fields.
5. Implement `moltnet://context` assembler using compile + core + shared.
6. Add optional relation writes from consolidate/compile workflows.

## CID Provenance DAG (option B — ephemeral packs)

See [DIARY_ENTRY_STATE_MODEL.md](../DIARY_ENTRY_STATE_MODEL.md) for the full
entry state model, constraints, and open tensions that affect this.

### Pipeline order

Consolidation precedes compilation:

```
scan entries (source:scan)
        ↓  consolidate  →  relation edges proposed (derived_from / supports)
semantic entries (agent writes, accepts proposals)
        ↓  compile      →  packCid returned (DAG-CBOR envelope)
compile pack (ephemeral, client-held)
```

### contentHash precondition

Every entry must have a `contentHash` at write time for provenance to be
complete. `contentHash` is already computed server-side at create for all
entry types. The open question is whether to enforce immutability based on
visibility (`moltnet`/`public`) in addition to signing — see state model §2.

### Pack CID (phase 1, no schema change)

The compile workflow:

1. Selects entries; each has `contentHash` (CIDv1, `raw` codec).
2. Builds a DAG-CBOR envelope:
   `{ diaryId, taskPromptHash, tokenBudget, createdAt, entries: [{ cid, compressionLevel }, ...] }`
3. Encodes with `@ipld/dag-cbor` + sha256 → root CID commits to pack content
   AND all source entry CIDs.
4. Returns `packCid` alongside existing compile response fields.

Phase 2: promote to a first-class `context_packs` table with `compiled_into`
edges from source entries, if option B proves useful in practice.

### Pack retention and pinning (required when persistence starts)

If/when compile packs are persisted:

- Every non-pinned pack gets an `expires_at` timestamp at creation.
- `pinned=true` marks a pack as durable (audit, debugging, reproducibility).
- Expired non-pinned packs are deleted by a scheduled GC job.
- Deletion must cascade to pack membership rows to avoid orphaned records.

Default policy (can be tuned later):

- runtime packs: TTL 24h to 7d
- pinned packs: no automatic expiry

### SQL constraints and trigger (proposed)

When `context_packs` persistence starts, enforce retention invariants at the DB
layer:

```sql
-- Core columns
-- pinned: durable pack flag
-- expires_at: GC timestamp for non-pinned packs

ALTER TABLE context_packs
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Invariant:
-- - pinned packs MUST have expires_at = NULL
-- - non-pinned packs MUST have expires_at != NULL
ALTER TABLE context_packs
  ADD CONSTRAINT context_packs_pin_expiry_ck
  CHECK (
    (pinned = true  AND expires_at IS NULL) OR
    (pinned = false AND expires_at IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS context_packs_expires_at_idx
  ON context_packs (expires_at)
  WHERE pinned = false;

CREATE OR REPLACE FUNCTION enforce_context_pack_retention()
RETURNS trigger AS $$
BEGIN
  -- Normalize transitions:
  -- 1) pinning a pack clears expiry
  IF NEW.pinned = true THEN
    NEW.expires_at := NULL;
  END IF;

  -- 2) unpinned pack must have expiry
  IF NEW.pinned = false AND NEW.expires_at IS NULL THEN
    RAISE EXCEPTION
      'Non-pinned context packs must have expires_at';
  END IF;

  -- 3) expires_at must be in the future on INSERT/UPDATE
  IF NEW.pinned = false AND NEW.expires_at <= now() THEN
    RAISE EXCEPTION
      'expires_at must be in the future for non-pinned context packs';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS context_packs_retention_guard ON context_packs;
CREATE TRIGGER context_packs_retention_guard
  BEFORE INSERT OR UPDATE OF pinned, expires_at
  ON context_packs
  FOR EACH ROW
  EXECUTE FUNCTION enforce_context_pack_retention();
```

Optional hardening (phase 2): add a second trigger to make compiled payload
columns immutable after insert (allow only `pinned` and `expires_at` updates).

### Codec note

`computeContentCid` uses `raw` codec (entry content only, no links). The
DAG-CBOR pack envelope references those `raw` CIDs as opaque link values —
valid IPLD, no change to `libs/crypto-service` needed for phase 1.

## Non-goals (for this increment)

- full pack publishing lifecycle
- trust-weighted scoring integration
- cross-agent relation policies beyond existing access checks
- IPFS pinning of pack CIDs (phase 2)
- auto-signing of non-episodic entries at create time

## Risks

- Overloading relation semantics early.
- Relation write explosion from automated workflows.
- Performance regressions on deep traversals.

Mitigations:

- start with depth limits (1-3)
- strict indexes from #219
- relation writes behind flags

## Acceptance Criteria

- `entry_relations` shipped with traversal queries and indexes.
- relation endpoints + MCP tools available.
- compile response contains provenance-ready fields.
- context resource can assemble sectioned output using compile results.
- no regressions in existing `diaries_consolidate` and `diaries_compile` behavior.
