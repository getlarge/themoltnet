import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Local diary: JSONL-based persistent memory across sessions
//
// Maps to MoltNet's diary_create / diary_search.
// Each entry is a line of JSON in a .jsonl file.
// ---------------------------------------------------------------------------

export interface DiaryEntry {
  timestamp: string;
  type: 'observation' | 'decision' | 'conversation' | 'reflection';
  summary: string;
  tags: string[];
}

export class Diary {
  private readonly filePath: string;

  constructor(channelDir: string, agentName: string) {
    const diaryDir = join(channelDir, '.diaries');
    if (!existsSync(diaryDir)) {
      mkdirSync(diaryDir, { recursive: true });
    }
    this.filePath = join(diaryDir, `${agentName}.jsonl`);
  }

  write(entry: Omit<DiaryEntry, 'timestamp'>): string {
    const full: DiaryEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(this.filePath, JSON.stringify(full) + '\n');
    return `Remembered: ${full.summary}`;
  }

  readRecent(count = 20): DiaryEntry[] {
    if (!existsSync(this.filePath)) return [];

    const lines = readFileSync(this.filePath, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean);

    return lines.slice(-count).map((line) => JSON.parse(line) as DiaryEntry);
  }

  search(query: string): DiaryEntry[] {
    const entries = this.readRecent(100);
    const terms = query.toLowerCase().split(/\s+/);
    return entries.filter((e) => {
      const text = `${e.summary} ${e.tags.join(' ')}`.toLowerCase();
      return terms.some((t) => text.includes(t));
    });
  }

  formatForContext(count = 10): string[] {
    const entries = this.readRecent(count);
    return entries.map(
      (e) =>
        `[${e.timestamp.slice(0, 16)}] (${e.type}) ${e.summary}` +
        (e.tags.length > 0 ? ` [${e.tags.join(', ')}]` : ''),
    );
  }
}

// ---------------------------------------------------------------------------
// Tool definitions for diary operations
// ---------------------------------------------------------------------------

export const diaryTools: Anthropic.Messages.Tool[] = [
  {
    name: 'diary_write',
    description:
      'Write something to your diary to remember across sessions. ' +
      'Use for important observations, decisions, or things you want to recall later. ' +
      'Maps to MoltNet diary_create.',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: {
          type: 'string',
          description: 'What to remember (1-2 sentences)',
        },
        type: {
          type: 'string',
          enum: ['observation', 'decision', 'conversation', 'reflection'],
          description: 'The kind of memory',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Tags for later retrieval (e.g., ["auth", "architecture"])',
        },
      },
      required: ['summary', 'type', 'tags'],
    },
  },
  {
    name: 'diary_recall',
    description:
      'Search your diary for past memories matching a keyword. ' +
      'Maps to MoltNet diary_search.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Keyword(s) to search for in diary entries',
        },
      },
      required: ['query'],
    },
  },
];

export function executeDiaryTool(
  diary: Diary,
  name: string,
  input: Record<string, unknown>,
): string {
  switch (name) {
    case 'diary_write': {
      const summary = input['summary'] as string;
      const type = (input['type'] as DiaryEntry['type']) ?? 'observation';
      const tags = (input['tags'] as string[]) ?? [];
      return diary.write({ summary, type, tags });
    }
    case 'diary_recall': {
      const query = input['query'] as string;
      const results = diary.search(query);
      if (results.length === 0) return 'No matching memories found.';
      return results
        .map(
          (e) =>
            `[${e.timestamp.slice(0, 16)}] (${e.type}) ${e.summary}` +
            (e.tags.length > 0 ? ` [${e.tags.join(', ')}]` : ''),
        )
        .join('\n');
    }
    default:
      return `error: unknown diary tool ${name}`;
  }
}
