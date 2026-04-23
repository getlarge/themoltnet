import {
  Task,
  TaskAttempt,
  type Task as TaskRow,
  type TaskAttempt as TaskAttemptRow,
} from '@moltnet/tasks';
import { Value } from '@sinclair/typebox/value';

import type { ClaimedTask, TaskSource } from './types.js';

export interface ApiTaskSourceOptions {
  baseUrl: string;
  taskId: string;
  auth: () => Promise<string>;
  leaseTtlSec?: number;
  fetch?: typeof fetch;
}

interface ClaimTaskResponse {
  task: unknown;
  attempt: unknown;
}

/**
 * Claim exactly one task from the Tasks API, then exhaust.
 *
 * This is intentionally narrow for the first API-backed runtime demo:
 * the caller creates a task, passes its id here, and the runtime claims it
 * through the real REST lifecycle instead of replaying a local JSON file.
 */
export class ApiTaskSource implements TaskSource {
  private claimed = false;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ApiTaskSourceOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async claim(): Promise<ClaimedTask | null> {
    if (this.claimed) return null;

    const token = await this.opts.auth();
    const response = await this.fetchImpl(
      `${this.baseUrl}/tasks/${this.opts.taskId}/claim`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          this.opts.leaseTtlSec ? { leaseTtlSec: this.opts.leaseTtlSec } : {},
        ),
      },
    );

    if (!response.ok) {
      throw new Error(
        `ApiTaskSource: claim failed for task ${this.opts.taskId}: ` +
          `${response.status} ${response.statusText}`,
      );
    }
    this.claimed = true;

    const body = (await response.json()) as ClaimTaskResponse;
    if (!Value.Check(Task, body.task)) {
      const firstError = [...Value.Errors(Task, body.task)][0];
      const where = firstError
        ? `${firstError.path} ${firstError.message}`
        : 'unknown';
      throw new Error(
        `ApiTaskSource: claim response task failed validation: ${where}`,
      );
    }
    if (!Value.Check(TaskAttempt, body.attempt)) {
      const firstError = [...Value.Errors(TaskAttempt, body.attempt)][0];
      const where = firstError
        ? `${firstError.path} ${firstError.message}`
        : 'unknown';
      throw new Error(
        `ApiTaskSource: claim response attempt failed validation: ${where}`,
      );
    }

    const task = body.task as TaskRow;
    const attempt = body.attempt as TaskAttemptRow;

    return {
      task,
      attemptN: attempt.attemptN,
    };
  }

  async close(): Promise<void> {
    // Stateless; nothing to release.
  }
}
