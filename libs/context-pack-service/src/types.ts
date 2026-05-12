import type { KetoNamespace } from '@moltnet/auth';
import type { CompressionLevel } from '@moltnet/crypto-service';
import type {
  ContextPackWithCreator,
  ExpandedPackEntry,
  PackDiffCompressionLevel,
  PackDiffRow,
  PrincipalIdentity,
  RenderedPackWithCreator,
} from '@moltnet/database';

export type { PackDiffCompressionLevel, PackDiffRow };

/**
 * Discriminated principal — caller resolves (identityId, ns) at the auth
 * boundary. For human, `id` is humans.id (NOT the Kratos identityId).
 */
export interface PackCreator {
  kind: 'agent' | 'human';
  id: string;
}

export interface SelectedEntry {
  entryId: string;
  rank: number;
}

export interface ResolvedSelection {
  rank: number;
  row: {
    id: string;
    content: string;
    contentHash: string | null;
    importance: number;
    createdAt: Date;
  };
}

export interface FittedEntry {
  entryId: string;
  entryCidSnapshot: string;
  rank: number;
  compressionLevel: CompressionLevel;
  originalTokens: number;
  packedTokens: number;
}

export interface FitResult {
  entries: FittedEntry[];
  stats: FitStats;
}

export interface FitStats {
  totalTokens: number;
  entriesIncluded: number;
  entriesCompressed: number;
  compressionRatio: number;
  budgetUtilization: number;
  elapsedMs: number;
}

export interface CreateCustomPackInput {
  diaryId: string;
  entries: SelectedEntry[];
  params: Record<string, unknown>;
  tokenBudget?: number;
  pinned?: boolean;
  creator: PackCreator;
  ttlDays?: number;
}

export interface CreateRenderedPackInput {
  sourcePackId: string;
  renderedMarkdown?: string;
  renderMethod: string;
  creator: PackCreator;
  pinned?: boolean;
  ttlDays?: number;
}

export interface PreviewRenderedPackInput {
  sourcePackId: string;
  renderedMarkdown?: string;
  renderMethod: string;
}

export interface RenderedPackResult {
  id: string;
  packCid: string;
  sourcePackId: string;
  sourcePackCid: string;
  diaryId: string;
  contentHash: string;
  renderMethod: string;
  renderedMarkdown: string;
  totalTokens: number;
  creator: PrincipalIdentity;
  pinned: boolean;
}

export interface RenderedPackPreview {
  sourcePackId: string;
  sourcePackCid: string;
  renderMethod: string;
  renderedMarkdown: string;
  totalTokens: number;
}

export interface PackActor {
  identityId: string;
  subjectNs: KetoNamespace;
}

export interface ListPacksByEntryInput {
  entryId: string;
  actor: PackActor;
  diaryId?: string;
  limit?: number;
  offset?: number;
  includeRendered?: boolean;
}

export interface PacksByEntryResult {
  items: ContextPackWithCreator[];
  total: number;
  renderedPacks?: RenderedPackWithCreator[];
}

export interface GetPackByIdInput {
  packId: string;
  actor: PackActor;
  expandEntries?: boolean;
}

export type PackWithOptionalEntries = ContextPackWithCreator & {
  entries?: ExpandedPackEntry[];
};

export interface ListPacksByDiaryInput {
  diaryId: string;
  actor: PackActor;
  limit?: number;
  offset?: number;
  expandEntries?: boolean;
}

export interface ListPacksByDiaryResult {
  items: PackWithOptionalEntries[];
  total: number;
  limit: number;
  offset: number;
}

export interface GetLatestRenderedPackInput {
  sourcePackId: string;
  actor: PackActor;
}

export interface GetRenderedPackByIdInput {
  renderedPackId: string;
  actor: PackActor;
}

export interface ListRenderedPacksByDiaryInput {
  diaryId: string;
  actor: PackActor;
  limit?: number;
  offset?: number;
  sourcePackId?: string;
  renderMethod?: string;
}

export interface ListRenderedPacksByDiaryResult {
  items: RenderedPackWithCreator[];
  total: number;
  limit: number;
  offset: number;
}

export interface GetPackForProvenanceInput {
  actor: PackActor;
  packId?: string;
  packCid?: string;
}

export type PackType = 'compile' | 'optimized' | 'custom';

export interface PackDiffEntryBase {
  entryId: string;
  title: string | null;
  entryCidSnapshot: string;
  compressionLevel: PackDiffCompressionLevel;
  packedTokens: number | null;
}

export interface PackDiffAddedEntry extends PackDiffEntryBase {
  rank: number;
}

export interface PackDiffRemovedEntry extends PackDiffEntryBase {
  rank: number;
}

export interface PackDiffReorderedEntry extends PackDiffEntryBase {
  oldRank: number;
  newRank: number;
}

export interface PackDiffChangedEntry {
  entryId: string;
  rank: number;
  title: string | null;
  oldEntryCidSnapshot: string;
  newEntryCidSnapshot: string;
  oldCompressionLevel: PackDiffCompressionLevel;
  newCompressionLevel: PackDiffCompressionLevel;
  oldPackedTokens: number | null;
  newPackedTokens: number | null;
  tokenDelta: number;
}

export interface PackDiffPackMeta {
  id: string;
  packCid: string;
  totalTokens: number | null;
  packType: PackType;
  createdAt: Date | string;
}

export interface PackDiffStats {
  addedCount: number;
  removedCount: number;
  reorderedCount: number;
  changedCount: number;
  tokenDelta: number;
  packA: PackDiffPackMeta;
  packB: PackDiffPackMeta;
}

export interface PackDiffResult {
  added: PackDiffAddedEntry[];
  removed: PackDiffRemovedEntry[];
  reordered: PackDiffReorderedEntry[];
  changed: PackDiffChangedEntry[];
  stats: PackDiffStats;
}

export interface DiffPacksInput {
  actor: PackActor;
  packAId?: string;
  packBId?: string;
  packACid?: string;
  packBCid?: string;
}
