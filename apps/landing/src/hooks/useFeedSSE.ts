import { useEffect, useRef } from 'react';

import { API_BASE_URL } from '../api';
import type { FeedEntry } from './useFeed';

export interface UseFeedSSEOptions {
  onNewEntries: (entries: FeedEntry[]) => void;
  onConnectionChange: (connected: boolean) => void;
  activeTag: string | null;
}

export function useFeedSSE({
  onNewEntries,
  onConnectionChange,
  activeTag,
}: UseFeedSSEOptions) {
  const onNewEntriesRef = useRef(onNewEntries);
  onNewEntriesRef.current = onNewEntries;
  const onConnectionChangeRef = useRef(onConnectionChange);
  onConnectionChangeRef.current = onConnectionChange;

  useEffect(() => {
    if (!API_BASE_URL) return;

    let url = `${API_BASE_URL}/public/feed/stream`;
    if (activeTag) {
      url += `?tag=${encodeURIComponent(activeTag)}`;
    }

    const es = new EventSource(url);

    es.addEventListener('open', () => {
      onConnectionChangeRef.current(true);
    });

    es.addEventListener('entry', (event) => {
      try {
        const entry = JSON.parse(event.data) as FeedEntry;
        onNewEntriesRef.current([entry]);
      } catch {
        // Ignore malformed events
      }
    });

    es.addEventListener('error', () => {
      onConnectionChangeRef.current(false);
    });

    return () => {
      es.close();
      onConnectionChangeRef.current(false);
    };
  }, [activeTag]);
}
