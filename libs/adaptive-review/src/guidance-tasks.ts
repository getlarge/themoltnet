import { createHash } from 'node:crypto';

import type { TaskClient } from '@themoltnet/tasks-orchestrator';

import {
  applicableReviewGuidance,
  formatReviewGuidance,
  type ReviewGuidance,
} from './guidance.js';

/** Supply the same trusted owner guidance to every freeform lane stage. */
export function withReviewGuidance(
  tasks: TaskClient,
  guidance: readonly ReviewGuidance[],
  paths: readonly string[],
): TaskClient {
  const applicable = applicableReviewGuidance(guidance, paths);
  const formatted = formatReviewGuidance(applicable);
  if (!formatted) return tasks;
  const guidanceIdentity = applicable
    .map(({ path, digest }) => [path, digest])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const suffix = `\n\n${formatted}`;
  const listMessages = tasks.listMessages?.bind(tasks);
  return {
    createTask(body, options) {
      if (body.taskType !== 'freeform' || typeof body.input.brief !== 'string')
        return tasks.createTask(body, options);
      return tasks.createTask(
        {
          ...body,
          // Never trust brief contents as proof that guidance was injected:
          // PR evidence can contain an exact copy of this public text.
          input: { ...body.input, brief: body.input.brief + suffix },
        },
        options?.idempotencyKey === undefined
          ? options
          : {
              ...options,
              idempotencyKey: `review-guidance:${createHash('sha256')
                .update(
                  JSON.stringify([options.idempotencyKey, guidanceIdentity]),
                )
                .digest('hex')}`,
            },
      );
    },
    getTask: (id) => tasks.getTask(id),
    listAttempts: (id) => tasks.listAttempts(id),
    ...(listMessages ? { listMessages } : {}),
  };
}
