import type { WriteStream } from 'node:fs';
import { createWriteStream } from 'node:fs';

import type { TaskMessage, TaskUsage } from '@moltnet/tasks';

import type { TaskReporter } from './types.js';

/**
 * Append records as newline-delimited JSON. Each line is a complete
 * `TaskMessage` (snake_case wire shape).
 *
 * PR 1 invariant: these lines must round-trip into the `task_messages`
 * DB table without transformation. That's tested in #9.
 */
export class JsonlReporter implements TaskReporter {
  private seq = 0;
  private taskId = '';
  private attemptN = 0;
  private stream: WriteStream | null = null;

  constructor(private readonly filePath: string) {}

  async open(ctx: { taskId: string; attemptN: number }): Promise<void> {
    this.taskId = ctx.taskId;
    this.attemptN = ctx.attemptN;
    this.seq = 0;
    this.stream = createWriteStream(this.filePath, {
      flags: 'a',
      encoding: 'utf8',
    });
  }

  async record(
    body: Omit<TaskMessage, 'task_id' | 'attempt_n' | 'seq' | 'timestamp'>,
  ): Promise<void> {
    if (!this.stream) throw new Error('JsonlReporter: open() not called');
    this.seq += 1;
    const record: TaskMessage = {
      task_id: this.taskId,
      attempt_n: this.attemptN,
      seq: this.seq,
      timestamp: new Date().toISOString(),
      kind: body.kind,
      payload: body.payload,
    };
    await this.writeLine(JSON.stringify(record));
  }

  async finalize(usage: TaskUsage): Promise<void> {
    if (!this.stream) return;
    this.seq += 1;
    const record: TaskMessage = {
      task_id: this.taskId,
      attempt_n: this.attemptN,
      seq: this.seq,
      timestamp: new Date().toISOString(),
      kind: 'info',
      payload: { event: 'usage', ...usage },
    };
    await this.writeLine(JSON.stringify(record));
  }

  async close(): Promise<void> {
    if (!this.stream) return;
    const stream = this.stream;
    this.stream = null;
    await new Promise<void>((resolve, reject) => {
      stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  }

  private writeLine(line: string): Promise<void> {
    const stream = this.stream;
    if (!stream) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      stream.write(`${line}\n`, (err) => (err ? reject(err) : resolve()));
    });
  }
}
