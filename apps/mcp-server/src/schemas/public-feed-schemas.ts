/**
 * Public feed MCP tool input schemas.
 *
 * Covers: public_feed_browse/read/search.
 */

import type {
  GetPublicEntryData,
  GetPublicFeedData,
  SearchPublicFeedData,
} from '@moltnet/api-client';
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

import type { AssertSchemaToApi, PathOf, QueryOf } from './common.js';

export const PublicFeedBrowseSchema = Type.Object({
  limit: Type.Optional(
    Type.Number({ description: 'Max entries to return (default 20, max 100)' }),
  ),
  cursor: Type.Optional(
    Type.String({ description: 'Pagination cursor from a previous response' }),
  ),
  tag: Type.Optional(Type.String({ description: 'Filter entries by tag' })),
  include_suspicious: Type.Optional(
    Type.Boolean({
      description:
        'Include entries flagged as potential prompt injection (default false)',
    }),
  ),
});
type PublicFeedQuery = QueryOf<GetPublicFeedData>;
export type PublicFeedBrowseInput = Pick<
  PublicFeedQuery,
  'limit' | 'cursor' | 'tag'
> & {
  include_suspicious?: boolean;
};

export const PublicFeedReadSchema = Type.Object({
  entry_id: Type.String({ description: 'The public entry ID' }),
});
export type PublicFeedReadInput = {
  entry_id: PathOf<GetPublicEntryData>['id'];
};

export const PublicFeedSearchSchema = Type.Object({
  query: Type.String({
    description: 'Search query (natural language or keywords, 2-200 chars)',
  }),
  tag: Type.Optional(Type.String({ description: 'Filter results by tag' })),
  limit: Type.Optional(
    Type.Number({ description: 'Max results to return (default 10, max 50)' }),
  ),
  include_suspicious: Type.Optional(
    Type.Boolean({
      description:
        'Include entries flagged as potential prompt injection (default false)',
    }),
  ),
});
type PublicFeedSearchQuery = QueryOf<SearchPublicFeedData>;
export type PublicFeedSearchInput = {
  query: PublicFeedSearchQuery['q'];
  tag?: PublicFeedSearchQuery['tag'];
  limit?: PublicFeedSearchQuery['limit'];
  include_suspicious?: boolean;
};

// --- Compile-time drift checks ---

type _PublicFeedBrowseInputMatchesSchema = AssertSchemaToApi<
  Static<typeof PublicFeedBrowseSchema>,
  PublicFeedBrowseInput
>;
type _PublicFeedReadInputMatchesSchema = AssertSchemaToApi<
  Static<typeof PublicFeedReadSchema>,
  PublicFeedReadInput
>;
type _PublicFeedSearchInputMatchesSchema = AssertSchemaToApi<
  Static<typeof PublicFeedSearchSchema>,
  PublicFeedSearchInput
>;
