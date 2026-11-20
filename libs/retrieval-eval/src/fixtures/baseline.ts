/**
 * Small retrieval baseline for #552.
 *
 * Text, titles, tags, importance and queries are copied from the source tests at
 * SOURCE_REVISION. Stable IDs and relevance judgments are new evaluation metadata.
 * These binary judgments define this baseline; changing them requires review.
 *
 * Every query is judged against the ENTIRE corpus. Entries absent from relevantIds
 * are nonrelevant for that query, including lexical matches that do not answer it.
 * The rationales explain this editorial choice; model output must not set labels.
 * This is a small development set, not an independent held-out benchmark.
 *
 * Do not import the source test modules: importing them registers tests and hooks.
 * Their handcrafted vectors are deliberately not copied; the runner will embed
 * this unchanged prose with the existing embedding service.
 */
export const SOURCE_REVISION = 'cf291d782d6e0f3da1e83274ce6306762b23e1af';

const SERVICE_SOURCE =
  'libs/diary-service/__tests__/diary-service.integration.test.ts';
const DATABASE_SOURCE =
  'libs/database/__tests__/diary.repository.integration.test.ts';

interface FixtureSource {
  readonly path: string;
  readonly test: string;
}

export interface RetrievalEntry {
  readonly id: string;
  readonly content: string;
  readonly title?: string;
  readonly tags?: readonly string[];
  readonly importance?: number;
  readonly source: FixtureSource;
}

export interface RetrievalQuery {
  readonly id: string;
  readonly query: string;
  readonly relevantIds: readonly string[];
  readonly rationale: string;
  readonly source: FixtureSource;
}

export const retrievalEntries: readonly RetrievalEntry[] = [
  {
    id: 'key-exchange',
    content: 'Cryptographic key exchange protocols are fascinating.',
    source: { path: SERVICE_SOURCE, test: 'searches by text query' },
  },
  {
    id: 'weather',
    content: 'The weather is sunny today.',
    source: { path: SERVICE_SOURCE, test: 'searches by text query' },
  },
  {
    id: 'ed25519',
    content:
      'Ed25519 is an elliptic curve digital signature algorithm used for cryptographic identity verification.',
    source: {
      path: SERVICE_SOURCE,
      test: 'finds semantically similar entries via hybrid search',
    },
  },
  {
    id: 'pasta',
    content: 'I had pasta with tomato sauce for dinner last night.',
    source: {
      path: SERVICE_SOURCE,
      test: 'finds semantically similar entries via hybrid search',
    },
  },
  {
    id: 'signature-algorithms',
    content:
      'I studied cryptographic signature algorithms and key derivation functions.',
    source: {
      path: DATABASE_SOURCE,
      test: 'performs hybrid search when both query and embedding are provided',
    },
  },
  {
    id: 'ducks',
    content: 'Observed mallard ducks and geese at the pond today.',
    source: {
      path: DATABASE_SOURCE,
      test: 'performs hybrid search when both query and embedding are provided',
    },
  },
  {
    id: 'fishing',
    title: 'Fishing notes',
    content: 'Fishing requires patience, knots, bait, and reading water.',
    importance: 1,
    source: {
      path: DATABASE_SOURCE,
      test: 'keeps a clear relevance match above unrelated recency and importance boosts',
    },
  },
  {
    id: 'jwt-rollout',
    title: 'JWT rollout',
    content: 'JWT authentication rollout and deployment checklist.',
    importance: 10,
    source: {
      path: DATABASE_SOURCE,
      test: 'keeps a clear relevance match above unrelated recency and importance boosts',
    },
  },
  {
    id: 'angling',
    title: 'Angling field notes',
    content: 'Knots, bait choice, and reading river structure.',
    importance: 1,
    source: {
      path: DATABASE_SOURCE,
      test: 'keeps a semantic vector match above unrelated recency and importance boosts',
    },
  },
  {
    id: 'ranking-incident',
    title: 'Diary search ranking incident',
    content:
      'Why does diary search return recent important entries instead of relevant RRF scoring matches? Investigated the ranking bug and normalized RRF scoring so relevance dominates recency and importance boosts.',
    importance: 3,
    tags: ['search', 'ranking'],
    source: {
      path: DATABASE_SOURCE,
      test: 'ranks the best long-query match above ambiguous diary entries',
    },
  },
  {
    id: 'search-ui-copy',
    title: 'Search UI copy',
    content:
      'Why does diary search return recent important entries instead of relevant RRF scoring matches? Updated UI copy for this troubleshooting prompt, without changing retrieval behavior.',
    importance: 8,
    tags: ['search', 'ui'],
    source: {
      path: DATABASE_SOURCE,
      test: 'ranks the best long-query match above ambiguous diary entries',
    },
  },
  {
    id: 'retrieval-tuning',
    title: 'Memory retrieval tuning',
    content:
      'Tuned retrieval so task-relevant memories are selected before generic recent notes.',
    importance: 8,
    tags: ['retrieval'],
    source: {
      path: DATABASE_SOURCE,
      test: 'ranks the best long-query match above ambiguous diary entries',
    },
  },
];

export const retrievalQueries: readonly RetrievalQuery[] = [
  {
    id: 'protocols',
    query: 'cryptographic protocols',
    relevantIds: ['key-exchange'],
    rationale:
      'Interpret protocols as key-exchange protocols. Signature algorithms and JWT rollout are adjacent topics but do not describe a protocol. Weather is unrelated.',
    source: { path: SERVICE_SOURCE, test: 'searches by text query' },
  },
  {
    id: 'signatures',
    query: 'public key cryptography and digital signatures',
    relevantIds: ['ed25519', 'signature-algorithms'],
    rationale:
      'Both entries discuss signature algorithms. The key-exchange entry does not discuss public keys or signatures; JWT rollout does not explain the cryptography.',
    source: {
      path: SERVICE_SOURCE,
      test: 'finds semantically similar entries via hybrid search',
    },
  },
  {
    id: 'algorithms',
    query: 'cryptographic algorithms',
    relevantIds: ['ed25519', 'signature-algorithms'],
    rationale:
      'Both entries name or discuss cryptographic algorithms. Key exchange mentions protocols without an algorithm, and JWT rollout is an operational checklist.',
    source: {
      path: DATABASE_SOURCE,
      test: 'performs hybrid search when both query and embedding are provided',
    },
  },
  {
    id: 'fishing',
    query: 'fishing',
    relevantIds: ['fishing', 'angling'],
    rationale:
      'Fishing and angling describe the same activity. Observing ducks at a pond is not fishing advice despite the shared setting.',
    source: {
      path: DATABASE_SOURCE,
      test: 'keeps a semantic vector match above unrelated recency and importance boosts',
    },
  },
  {
    id: 'ranking',
    query:
      'why does diary search return recent important entries instead of relevant RRF scoring matches',
    relevantIds: ['ranking-incident', 'retrieval-tuning'],
    rationale:
      'The incident explains the scoring problem; retrieval tuning provides supporting information about prioritizing relevance. Search UI copy repeats the question but supplies no retrieval explanation or fix, so it is a lexical distractor.',
    source: {
      path: DATABASE_SOURCE,
      test: 'ranks the best long-query match above ambiguous diary entries',
    },
  },
  {
    id: 'no-match',
    query: 'banana-impossible-sentinel',
    relevantIds: [],
    rationale:
      'No entry addresses this existing sentinel query. Every returned entry is a false positive; recall is undefined. This is a synthetic no-match check, not evidence about all natural-language no-match queries.',
    source: {
      path: DATABASE_SOURCE,
      test: 'does not return vector-only rows for a query with no meaningful match',
    },
  },
];
