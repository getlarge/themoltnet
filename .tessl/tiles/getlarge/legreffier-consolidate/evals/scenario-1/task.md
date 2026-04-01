# Prepare a Reviewable Relation Batch

## Problem/Feature Description

An agent has already identified several diary entry pairs that look worth
linking, but the team does not trust unlabeled graph edits or relation batches
that cannot be audited later. They want a reviewable proposal packet that a
human or another agent can inspect before deciding which edges to accept.

Create a relation proposal batch format and fill it with a handful of realistic
sample proposals for one consolidation run. The emphasis is on traceability and
review quality, not on acceptance.

## Output Specification

Produce these files:

- `relation-proposals.json` containing a small batch of sample relation
  proposals with metadata
- `review-packet.md` summarizing the working set, proposal counts, skipped
  candidates, and any open questions reviewers should inspect
