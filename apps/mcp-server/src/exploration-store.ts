import type {
  ExploreEntry,
  ExploreQueryState,
  ExploreTagCount,
} from '@moltnet/entry-explore-ui';

export interface StoredExplorationState {
  explorationId: string;
  sessionId: string | null;
  diaryId: string;
  diaryName: string;
  estimatedEntryCount: number;
  sampleEntries: ExploreEntry[];
  topTags: ExploreTagCount[];
  queryState: ExploreQueryState;
  visibleEntries: ExploreEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ExplorationStore {
  create(state: StoredExplorationState): Promise<void>;
  get(explorationId: string): Promise<StoredExplorationState | null>;
  update(
    explorationId: string,
    update: (
      current: StoredExplorationState,
    ) => StoredExplorationState | null | Promise<StoredExplorationState | null>,
  ): Promise<StoredExplorationState | null>;
  delete(explorationId: string): Promise<void>;
}

export class InMemoryExplorationStore implements ExplorationStore {
  readonly #items = new Map<string, StoredExplorationState>();

  create(state: StoredExplorationState): Promise<void> {
    this.#items.set(state.explorationId, state);
    return Promise.resolve();
  }

  get(explorationId: string): Promise<StoredExplorationState | null> {
    return Promise.resolve(this.#items.get(explorationId) ?? null);
  }

  async update(
    explorationId: string,
    update: (
      current: StoredExplorationState,
    ) => StoredExplorationState | null | Promise<StoredExplorationState | null>,
  ): Promise<StoredExplorationState | null> {
    const current = this.#items.get(explorationId);
    if (!current) return null;
    const next = await update(current);
    if (!next) {
      this.#items.delete(explorationId);
      return null;
    }
    this.#items.set(explorationId, next);
    return next;
  }

  delete(explorationId: string): Promise<void> {
    this.#items.delete(explorationId);
    return Promise.resolve();
  }
}
