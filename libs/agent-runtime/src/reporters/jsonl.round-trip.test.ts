/**
 * Round-trip test: JSONL reporter output must validate as TaskMessage[].
 *
 * This is the PR 0 ↔ PR 1 contract. If this test passes, PR 1's Drizzle
 * `task_messages` rows can be produced from JSONL lines without
 * transformation — `task_id`, `attempt_n`, `seq`, `timestamp`, `kind`,
 * `payload` are already the right names and types.
 *
 * If PR 1 renames a column, this test is the first thing that breaks,
 * which is the point.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TaskMessage } from '@moltnet/tasks';
import { FormatRegistry } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

// PR 1's Drizzle `task_messages.task_id` is a uuid column and
// `task_messages.timestamp` is a timestamptz. TypeBox doesn't validate
// string formats by default; register enough here to make the
// round-trip check meaningful.
if (!FormatRegistry.Has('uuid')) {
  FormatRegistry.Set('uuid', (v) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v,
    ),
  );
}
if (!FormatRegistry.Has('date-time')) {
  FormatRegistry.Set('date-time', (v) => !Number.isNaN(Date.parse(v)));
}

import { JsonlReporter } from './jsonl.js';

function parseJsonl(path: string): unknown[] {
  const raw = readFileSync(path, 'utf8');
  return raw
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as unknown);
}

describe('JsonlReporter round-trip', () => {
  it('produces records that validate as TaskMessage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jsonl-rt-'));
    const filePath = join(dir, 'attempt.jsonl');
    try {
      const reporter = new JsonlReporter(filePath);
      await reporter.open({
        taskId: '11111111-1111-4111-8111-111111111111',
        attemptN: 1,
      });

      await reporter.record({
        kind: 'info',
        payload: { event: 'execute_start', task_type: 'fulfill_brief' },
      });
      await reporter.record({
        kind: 'text_delta',
        payload: { delta: 'Hello, ' },
      });
      await reporter.record({
        kind: 'text_delta',
        payload: { delta: 'world.' },
      });
      await reporter.record({
        kind: 'tool_call_start',
        payload: { tool_name: 'Read' },
      });
      await reporter.record({
        kind: 'tool_call_end',
        payload: { tool_name: 'Read', is_error: false },
      });
      await reporter.record({
        kind: 'turn_end',
        payload: { stop_reason: 'end_turn' },
      });

      await reporter.finalize({
        input_tokens: 42,
        output_tokens: 17,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
      });
      await reporter.close();

      const records = parseJsonl(filePath);

      // 6 `record()` calls + 1 finalize row
      expect(records).toHaveLength(7);

      // Every row must validate against the wire-format TaskMessage schema.
      for (const row of records) {
        if (!Value.Check(TaskMessage, row)) {
          const errors = [...Value.Errors(TaskMessage, row)].map(
            (e) => `${e.path}: ${e.message}`,
          );
          throw new Error(
            `TaskMessage validation failed:\n${errors.join('\n')}\nrow: ${JSON.stringify(row)}`,
          );
        }
      }

      // seq is monotonic starting at 1, per-(task_id, attempt_n)
      const seqs = records.map((r) => (r as { seq: number }).seq);
      expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7]);

      // Every row carries the reporter-owned identity fields.
      for (const row of records) {
        const r = row as { task_id: string; attempt_n: number };
        expect(r.task_id).toBe('11111111-1111-4111-8111-111111111111');
        expect(r.attempt_n).toBe(1);
      }

      // finalize() emits an `info` row with a usage payload.
      const last = records.at(-1) as {
        kind: string;
        payload: Record<string, unknown>;
      };
      expect(last.kind).toBe('info');
      expect(last.payload).toMatchObject({
        event: 'usage',
        input_tokens: 42,
        output_tokens: 17,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
