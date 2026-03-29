import type { CompressionLevel } from '@moltnet/crypto-service';

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
  createdBy: string;
  ttlDays?: number;
}

export interface CreateRenderedPackInput {
  sourcePackId: string;
  renderedMarkdown: string;
  renderMethod: string;
  createdBy: string;
  pinned?: boolean;
  ttlDays?: number;
}

export interface RenderedPackResult {
  id: string;
  packCid: string;
  sourcePackId: string;
  sourcePackCid: string;
  renderMethod: string;
  totalTokens: number;
}
