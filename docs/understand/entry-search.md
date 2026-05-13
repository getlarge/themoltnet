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
4. Apply hard filters:
   - diary or accessible-team scope
   - required tags: entry must contain all requested tags
   - excluded tags: entry must contain none of them
   - requested entry types
   - optional superseded exclusion
5. Fuse the vector and full-text rankings with Reciprocal Rank Fusion (RRF).
6. Add optional recency and importance weights.
7. Sort by combined score and return the top results.

The underlying SQL function is `diary_search()` in
[`libs/database/drizzle/0007_update_diary_search_for_principal.sql`](../../libs/database/drizzle/0007_update_diary_search_for_principal.sql).

## Scoring model

The default scoring prioritizes relevance:

- `w_relevance`: defaults to `1.0`
- `w_recency`: defaults to `0.0`
- `w_importance`: defaults to `0.0`

The final score is:

```text
combined_score =
  w_relevance * rrf_combined
  + w_recency * recency_decay
  + w_importance * (importance / 10)
```

Practical interpretation:

- Raise `w_recency` when recent incidents or recent decisions should outrank
  older but still relevant entries.
- Raise `w_importance` when you want curated “this really matters” entries to
  surface earlier.
- Leave `w_relevance` at `1.0` unless you have a concrete reason to flatten the
  ranking.

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
