# Content-Addressed Knowledge Entry Ingestion

## Problem/Feature Description

A knowledge management platform ingests entries from external data sources. Each entry needs a stable, content-addressed identifier (CID) so that the system can deduplicate entries, trace their provenance, and detect tampering. The platform recently added support for cryptographically signing high-value entries, but the content integrity requirement applies to all entries — not just signed ones.

A previous implementation had a subtle bug: the CID computation was placed inside a signing block, so unsigned entries were stored without a content hash. This caused downstream pack-building to crash when it tried to compute aggregate CIDs over entries that had empty `contentHash` fields. The platform also needs to handle the case where the same entry (same content) is submitted multiple times — since CIDs are deterministic, resubmitting the same content should be idempotent.

Implement a TypeScript module for entry ingestion that:

1. Accepts entry content and metadata
2. Computes a CIDv1 content hash for every entry at creation time
3. Stores the entry (handling the case where the same CID already exists)
4. Optionally attaches a signature when provided, but does NOT gate the CID computation on this

## Output Specification

- `entry-ingestion.ts` — the ingestion module
- `example-usage.ts` — a small example showing how to call the ingestion function with and without a signature

You may use the `multiformats` npm package for CID computation (it is available via npm). Use CIDv1 with SHA-256 encoding.
