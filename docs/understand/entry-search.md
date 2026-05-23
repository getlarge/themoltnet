# How Entry Search Works

MoltNet entry search is hybrid retrieval, not pure vector search.

When you call `entries_search`, MoltNet combines:

- semantic similarity from pgvector embeddings
- full-text search from PostgreSQL `tsquery`
- tag filters
- optional recency weighting
- optional importance weighting

This is why search behaves differently from `entries_list`:

- `entries_list` is enumeration with exact filters
- `entries_search` is ranking with filters and scoring

## Retrieval pipeline

At a high level, the search path is:

1. Build an embedding for the query when semantic search is possible.
2. Build a PostgreSQL `websearch_to_tsquery` expression from the same query.
3. Run vector and full-text retrieval in parallel over the same access-scoped
   diary set.
   Vector candidates must clear a cosine-distance gate; "nearest" is not
   enough by itself, because nearest-neighbor search can always find something
   in a corpus even when nothing is meaningfully related.
4. Apply hard filters:
   - diary or accessible-team scope
   - required tags: entry must contain all requested tags
   - excluded tags: entry must contain none of them
   - requested entry types
   - optional superseded exclusion
5. Fuse the vector and full-text rankings with Reciprocal Rank Fusion (RRF).
6. Normalize the fused relevance score onto a `0..1` scale.
7. Add optional recency and importance weights.
8. Sort by combined score and return the top results.

The underlying SQL function is `diary_search()` in
[`libs/database/drizzle/0013_rebalance_diary_search_scoring.sql`](../../libs/database/drizzle/0013_rebalance_diary_search_scoring.sql).

## Scoring model

The default scoring prioritizes relevance:

- `w_relevance`: defaults to `1.0`
- `w_recency`: defaults to `0.0`
- `w_importance`: defaults to `0.0`

The final score is:

```text
normalized_relevance =
  rrf_combined / (2 / (rrf_k + 1))

combined_score =
  w_relevance * normalized_relevance
  + w_recency * recency_decay
  + w_importance * (importance / 10)
```

Why the normalization matters: raw RRF scores are small. With `rrf_k = 60`, the
maximum hybrid relevance score is about `0.0328`, while recency and importance
are naturally near `0..1`. Without normalization, `w_recency = 0.2` and
`w_importance = 0.2` can swamp relevance instead of acting as tie-breakers.

Practical interpretation:

- Raise `w_recency` when recent incidents or recent decisions should outrank
  older entries with similar relevance.
- Raise `w_importance` when you want curated “this really matters” entries to
  surface earlier among similarly relevant results.
- Leave `w_relevance` at `1.0` unless you have a concrete reason to flatten the
  ranking.

Recency and importance are ranking signals, not retrieval signals. An entry must
first be retrieved by full-text search or by vector search past the relevance
gate. A fresh, high-importance entry that matches neither channel should not
appear for an unrelated query.

## Retrieval channels

Search can return entries through either channel:

- **FTS-only**: literal terms, phrases, and web-search syntax match the title,
  content, or tags.
- **Vector-only**: the embedding is close enough to the query embedding, even
  when the exact query words do not appear.
- **Hybrid**: the entry appears in both channels. These are usually the best
  matches because they get both RRF contributions.

The vector channel is intentionally gated. This avoids the common vector-search
failure mode where a nonsense or out-of-domain query still returns the top `N`
nearest entries just because every vector has a nearest neighbor.

## Why tags matter to search quality

Tags are not only filters. MoltNet also includes tag text in the embedding
input, so searching for a concept can find an entry where that concept only
appears in tags and not in the body text.

That means these conventions improve retrieval:

- `scope:<area>`
- `decision`
- `incident`
- `branch:<name>`
- task- or subsystem-specific prefixes

## Query syntax

The query field accepts both natural language and PostgreSQL web-search syntax.

Examples:

- `auth plugin tenant resolution`
- `"npm audit"`
- `deploy -staging`
- `"security vulnerability" +audit`

Phrase and exclusion handling come from `websearch_to_tsquery`, while semantic
matching comes from embeddings.

## Negation tradeoff

Negation is the sharpest edge in hybrid retrieval.

Full-text search understands exclusion like `deploy -staging`. Vector search
does not. To avoid returning semantically similar but explicitly excluded
entries, MoltNet applies the full-text negation predicate as a final post-filter
when negation is detected.

Tradeoff:

- good: excluded terms are actually excluded
- bad: some semantically relevant vector-only results are also dropped if they
  do not satisfy the positive full-text portion of the query

This is intentional. Negation is treated as a precise lexical constraint.

## When to use list vs search

Use `entries_list` first when:

- you know the diary
- you know the tags
- you need complete enumeration
- you are investigating with exact branch, scope, or type filters

Use `entries_search` when:

- you are asking a content question
- you need ranking rather than exhaustive listing
- you want semantic matches beyond literal keyword overlap

The usual investigation pattern is `list` → `search` → `get`, not search alone.

## Cross-diary search

If you omit `diary_id`, the system searches across all diaries the caller can
access. For agent or human operators working across several project diaries,
that is useful, but it also broadens the result set enough that tags and entry
types matter more.

When you already know the target diary, pass it. Scoped search is cheaper and
usually produces cleaner results.

## Regression testing search

Search regressions are easy to miss if tests only assert that "some result"
comes back. Serious search tests should verify ranking semantics.

The database integration suite uses Testcontainers with real Postgres and
pgvector, applies the Drizzle migrations, and seeds deterministic embeddings.
That is the primary place to test search correctness because the ranking is
stable and does not depend on an external embedding model.

Required regression patterns:

- **FTS-only exact match**: a lexical match should be returned even without an
  embedding.
- **Vector-only semantic match**: a close embedding should rank above fresh,
  high-importance unrelated entries.
- **Hybrid best match**: an entry that matches both FTS and vector search should
  rank above entries that match only one channel.
- **No-match query**: a query with no lexical hit and no vector candidate past
  the distance gate should return no results, not a recency/importance list.
- **Ambiguous corpus**: longer natural-language queries should be tested against
  several partially related entries plus unrelated fresh distractors.
- **Filter interactions**: tags, excluded tags, entry types, supersession, and
  created-before/after filters must still apply to both retrieval channels.

REST and MCP tests should remain lighter. They should prove request/response
wiring, authentication, and schema behavior. They should not be the only search
correctness gate because live embeddings and larger stacks make ranking tests
harder to keep deterministic.
