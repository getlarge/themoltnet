import { getPublicFeed, searchPublicFeed } from '@moltnet/api-client';
import { useCallback, useEffect, useState } from 'react';

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

type FeedMode = 'feed' | 'search';
type FeedStatus = 'idle' | 'loading' | 'loading-more' | 'error';

export interface RateLimitError {
  retryAfter: number;
}

export interface UseFeedState {
  entries: FeedEntry[];
  pendingEntries: FeedEntry[];
  status: FeedStatus;
  hasMore: boolean;
  mode: FeedMode;
  searchQuery: string;
  activeTag: string | null;
  sseConnected: boolean;
  rateLimitError: RateLimitError | null;
}

export interface UseFeedActions {
  loadMore: () => void;
  submitSearch: (query: string) => void;
  clearSearch: () => void;
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
  const [mode, setMode] = useState<FeedMode>('feed');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTagState] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [rateLimitError, setRateLimitError] = useState<RateLimitError | null>(
    null,
  );

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

  const fetchSearch = useCallback(
    async (query: string) => {
      setStatus('loading');
      setRateLimitError(null);
      try {
        const { data, error, response } = await searchPublicFeed({
          client: apiClient,
          query: {
            q: query,
            limit: PAGE_SIZE,
            ...(activeTag ? { tag: activeTag } : {}),
          },
        });

        if (response.status === 429) {
          const retryAfter = Number(
            response.headers.get('retry-after') ?? '60',
          );
          setRateLimitError({ retryAfter });
          setStatus('idle');
          return;
        }

        if (error || !data) {
          setStatus('error');
          return;
        }

        setEntries(data.items as FeedEntry[]);
        setStatus('idle');
      } catch {
        setStatus('error');
      }
    },
    [activeTag],
  );

  // Reload when tag changes in feed mode
  useEffect(() => {
    setPendingEntries([]);
    if (mode === 'feed') {
      void fetchFeed();
    }
  }, [fetchFeed, mode]);

  // Run search when query or tag changes in search mode
  useEffect(() => {
    if (mode !== 'search' || !searchQuery) return;
    setPendingEntries([]);
    void fetchSearch(searchQuery);
  }, [fetchSearch, searchQuery, mode]);

  const loadMore = useCallback(() => {
    if (mode === 'search') return;
    if (status === 'loading' || status === 'loading-more' || !nextCursor)
      return;
    void fetchFeed(nextCursor, true);
  }, [mode, status, nextCursor, fetchFeed]);

  const submitSearch = useCallback((query: string) => {
    setMode('search');
    setSearchQuery(query);
    setPendingEntries([]);
    setNextCursor(null);
  }, []);

  const clearSearch = useCallback(() => {
    setMode('feed');
    setSearchQuery('');
    setRateLimitError(null);
    setPendingEntries([]);
    // fetchFeed will be triggered by the mode/activeTag useEffect
  }, []);

  const setActiveTag = useCallback((tag: string | null) => {
    setActiveTagState(tag);
  }, []);

  const addPendingEntries = useCallback(
    (newEntries: FeedEntry[]) => {
      if (mode === 'search') return;
      setPendingEntries((prev) => {
        const ids = new Set(prev.map((e) => e.id));
        const unique = newEntries.filter((e) => !ids.has(e.id));
        return [...unique, ...prev];
      });
    },
    [mode],
  );

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

  return {
    entries,
    pendingEntries,
    status,
    hasMore: mode === 'feed' && nextCursor !== null,
    mode,
    searchQuery,
    activeTag,
    sseConnected,
    rateLimitError,
    loadMore,
    submitSearch,
    clearSearch,
    setActiveTag,
    addPendingEntries,
    flushPending,
    setSseConnected,
  };
}
