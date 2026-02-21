/**
 * Public feed poller — polls the database for new public diary entries
 * and yields them as an AsyncGenerator.
 *
 * Uses `listPublicSince()` to fetch entries created after a cursor,
 * polling every `intervalMs` (default 3s).
 */

import type { DiaryEntryRepository, PublicFeedEntry } from '@moltnet/database';

export interface PublicFeedPollerOptions {
  diaryEntryRepository: DiaryEntryRepository;
  /** Polling interval in milliseconds (default: 3000) */
  intervalMs?: number;
  /** Optional tag filter */
  tag?: string;
  /** AbortSignal to stop polling */
  signal: AbortSignal;
  /** Starting cursor — entries after this point will be yielded */
  afterCreatedAt?: string;
  afterId?: string;
}

export async function* pollPublicFeed(
  options: PublicFeedPollerOptions,
): AsyncGenerator<PublicFeedEntry> {
  const { diaryEntryRepository, intervalMs = 3000, tag, signal } = options;

  let cursorCreatedAt = options.afterCreatedAt ?? new Date().toISOString();
  let cursorId = options.afterId ?? '00000000-0000-0000-0000-000000000000';

  while (!signal.aborted) {
    const entries = await diaryEntryRepository.listPublicSince({
      afterCreatedAt: cursorCreatedAt,
      afterId: cursorId,
      tag,
      limit: 50,
    });

    for (const entry of entries) {
      yield entry;
      // Advance cursor to the last yielded entry
      cursorCreatedAt = entry.createdAt.toISOString();
      cursorId = entry.id;
    }

    // Wait before next poll
    await sleep(intervalMs, signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
