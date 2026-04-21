import { readFile } from 'node:fs/promises';

import { BUILT_IN_TASK_TYPES, Task } from '@moltnet/tasks';
import { Value } from '@sinclair/typebox/value';

import type { TaskSource } from './types.js';

/**
 * Read one or more `Task` records from a JSON file.
 *
 * Accepts either a single Task object or an array of Tasks. Emits them in
 * order on successive `claim()` calls; returns `null` once exhausted.
 *
 * Validation runs at load time (not at claim time) so bad fixtures fail
 * before the runtime boots a VM.
 */
export class FileTaskSource implements TaskSource {
  private queue: Task[] = [];
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async claim(): Promise<Task | null> {
    if (!this.loaded) await this.load();
    return this.queue.shift() ?? null;
  }

  async close(): Promise<void> {
    this.queue = [];
  }

  private async load(): Promise<void> {
    const raw = await readFile(this.filePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `FileTaskSource: invalid JSON in ${this.filePath}: ${message}`,
      );
    }

    const candidates: unknown[] = Array.isArray(parsed)
      ? (parsed as unknown[])
      : [parsed];
    const validated: Task[] = [];
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate: unknown = candidates[i];
      if (!Value.Check(Task, candidate)) {
        const firstError = [...Value.Errors(Task, candidate)][0];
        const where = firstError
          ? `${firstError.path} ${firstError.message}`
          : 'unknown';
        throw new Error(
          `FileTaskSource: task[${i}] in ${this.filePath} does not match Task schema: ${where}`,
        );
      }
      const entry =
        BUILT_IN_TASK_TYPES[
          candidate.task_type as keyof typeof BUILT_IN_TASK_TYPES
        ];
      if (!entry) {
        throw new Error(
          `FileTaskSource: task[${i}] in ${this.filePath} has unknown task_type="${candidate.task_type}". ` +
            `Known types: ${Object.keys(BUILT_IN_TASK_TYPES).join(', ')}`,
        );
      }
      if (!Value.Check(entry.inputSchema, candidate.input)) {
        const firstError = [
          ...Value.Errors(entry.inputSchema, candidate.input),
        ][0];
        const where = firstError
          ? `${firstError.path} ${firstError.message}`
          : 'unknown';
        throw new Error(
          `FileTaskSource: task[${i}].input in ${this.filePath} does not match ${candidate.task_type} input schema: ${where}`,
        );
      }
      validated.push(candidate);
    }

    this.queue = validated;
    this.loaded = true;
  }
}
