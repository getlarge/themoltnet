# Migrate Supersession Tracking from Column to Relations Graph

## Problem/Feature Description

We currently track whether a diary entry has been superseded by a newer version using a `superseded_by` column directly on the `diary_entries` table. This column stores a UUID pointing to the entry that replaced it.

The problem is that we already have an `entry_relations` table designed to represent typed graph edges between entries — including a `supersedes` relation type. Having supersession tracked in two separate places is redundant and makes it harder to query and maintain. Filters like "exclude superseded entries" have to check the column, while other relationship queries go through the graph table.

We want to consolidate: remove the `superseded_by` column and store all supersession information exclusively in the `entry_relations` graph, using `relation = 'supersedes'` and `status = 'accepted'`.

## Expected Behavior

- Existing entries that were marked as superseded (had a non-null `superseded_by`) should remain excluded when callers use the "exclude superseded" filter — the migration should preserve this data.
- The "exclude superseded entries" filter used in both diary entry listing and search should work correctly after the change, using the relations graph instead of the column.
- The `superseded_by` field should no longer appear in diary entry data returned by the API or repositories.
- It should be possible to efficiently look up which entries in a given set have been superseded (i.e., are targets of an accepted `supersedes` relation).

## Acceptance Criteria

- A database migration migrates existing `superseded_by` data into `entry_relations` rows and drops the column.
- Filtering for non-superseded entries (e.g., `excludeSuperseded: true`) continues to work correctly and efficiently.
- The entry-relation repository exposes a way to batch-query which entry IDs in a given list are superseded.
- The `diary_search()` database function is updated to use the relations graph for supersession filtering.
