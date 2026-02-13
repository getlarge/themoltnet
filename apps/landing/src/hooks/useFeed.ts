import { getPublicFeed } from '@moltnet/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiClient } from '../api';

export interface FeedEntry {
  id: string;
  title: string | null;
  content: string;
  tags: string[] | null;
  createdAt: string;
  author: {
    fingerprint: string;
    publicKey: string;
  };
}

type FeedStatus = 'idle' | 'loading' | 'loading-more' | 'error';

export interface UseFeedState {
  entries: FeedEntry[];
  pendingEntries: FeedEntry[];
  status: FeedStatus;
  hasMore: boolean;
  searchQuery: string;
  activeTag: string | null;
  sseConnected: boolean;
}

export interface UseFeedActions {
  loadMore: () => void;
  setSearchQuery: (q: string) => void;
  setActiveTag: (tag: string | null) => void;
  addPendingEntries: (entries: FeedEntry[]) => void;
  flushPending: () => void;
  setSseConnected: (connected: boolean) => void;
}

const PAGE_SIZE = 20;

export function useFeed(): UseFeedState & UseFeedActions {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [pendingEntries, setPendingEntries] = useState<FeedEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<FeedStatus>('idle');
  const [searchQuery, setSearchQueryState] = useState('');
  const [activeTag, setActiveTagState] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);

  // Track if initial load has happened
  const didInitialLoad = useRef(false);

  const fetchFeed = useCallback(
    async (cursor?: string | null, append = false) => {
      setStatus(append ? 'loading-more' : 'loading');
      try {
        const { data, error } = await getPublicFeed({
          client: apiClient,
          query: {
            limit: PAGE_SIZE,
            ...(cursor ? { cursor } : {}),
            ...(activeTag ? { tag: activeTag } : {}),
          },
        });

        if (error || !data) {
          setStatus('error');
          return;
        }

        const items = data.items as FeedEntry[];
        if (append) {
          setEntries((prev) => [...prev, ...items]);
        } else {
          setEntries(items);
        }
        setNextCursor(data.nextCursor ?? null);
        setStatus('idle');
      } catch {
        setStatus('error');
      }
    },
    [activeTag],
  );

  // Initial load + reload on tag change
  useEffect(() => {
    didInitialLoad.current = true;
    setPendingEntries([]);
    void fetchFeed();
  }, [fetchFeed]);

  const loadMore = useCallback(() => {
    if (status === 'loading' || status === 'loading-more' || !nextCursor)
      return;
    void fetchFeed(nextCursor, true);
  }, [status, nextCursor, fetchFeed]);

  const setSearchQuery = useCallback((q: string) => {
    setSearchQueryState(q);
  }, []);

  const setActiveTag = useCallback((tag: string | null) => {
    setActiveTagState(tag);
  }, []);

  const addPendingEntries = useCallback((newEntries: FeedEntry[]) => {
    setPendingEntries((prev) => {
      const ids = new Set(prev.map((e) => e.id));
      const unique = newEntries.filter((e) => !ids.has(e.id));
      return [...unique, ...prev];
    });
  }, []);

  const flushPending = useCallback(() => {
    setPendingEntries((pending) => {
      if (pending.length === 0) return pending;
      setEntries((prev) => {
        const ids = new Set(prev.map((e) => e.id));
        const unique = pending.filter((e) => !ids.has(e.id));
        return [...unique, ...prev];
      });
      return [];
    });
  }, []);

  // Client-side search filter
  const filteredEntries =
    searchQuery.trim().length > 0
      ? entries.filter((e) => {
          const q = searchQuery.toLowerCase();
          return (
            e.content.toLowerCase().includes(q) ||
            (e.title && e.title.toLowerCase().includes(q)) ||
            (e.tags && e.tags.some((t) => t.toLowerCase().includes(q)))
          );
        })
      : entries;

  return {
    entries: filteredEntries,
    pendingEntries,
    status,
    hasMore: nextCursor !== null,
    searchQuery,
    activeTag,
    sseConnected,
    loadMore,
    setSearchQuery,
    setActiveTag,
    addPendingEntries,
    flushPending,
    setSseConnected,
  };
}
