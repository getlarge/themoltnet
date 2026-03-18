/**
 * Diary-backed retrieval for context enrichment.
 *
 * Searches diary entries via MoltNet API (server-side e5-small-v2 + pgvector)
 * and returns top results as context for the AxLearn agent.
 */

import type { Agent } from '@themoltnet/sdk';

export interface DiaryRAGOptions {
  sdkAgent: Agent;
  diaryId: string;
  /** Max search results. Default: 5 */
  limit?: number;
}

export interface DiaryRAGResult {
  context: string;
  resultCount: number;
}

export async function queryDiary(
  question: string,
  options: DiaryRAGOptions,
): Promise<DiaryRAGResult> {
  const { sdkAgent, diaryId, limit = 5 } = options;

  const searchBody = {
    diaryId,
    query: question,
    limit,
  };
  const data = await sdkAgent.entries.search(searchBody);

  if (!data?.results?.length) {
    return { context: '', resultCount: 0 };
  }

  const context = data.results
    .map((e) => `[${e.entryType ?? 'entry'}] ${e.title ?? ''}\n${e.content}`)
    .join('\n\n---\n\n');

  return { context, resultCount: data.results.length };
}
