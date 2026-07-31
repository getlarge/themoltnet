import type { Agent } from '@themoltnet/sdk';

import type { SourceAttemptResolver } from './execution-plan-cache.js';

export function createApiSourceAttemptResolver(args: {
  agent: Agent;
}): SourceAttemptResolver {
  const { agent } = args;

  return {
    async findOutputBranch(input) {
      const attempts = await agent.tasks.listAttempts(input.taskId);
      const attempt = attempts.find(
        (candidate) => candidate.attemptN === input.attemptN,
      );
      if (!attempt || attempt.status !== 'completed') return null;
      return resolveOutputBranch(attempt.output);
    },
    async findInputRevision(input) {
      const task = await agent.tasks.get(input.taskId);
      if (
        task.status !== 'completed' ||
        task.acceptedAttemptN !== input.attemptN
      ) {
        return null;
      }
      return resolveInputRevision(task.input);
    },
  };
}

function resolveOutputBranch(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null;
  const branch = (output as { branch?: unknown }).branch;
  return typeof branch === 'string' && branch.length > 0 ? branch : null;
}

function resolveInputRevision(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const revision = (input as { execution?: { revision?: unknown } }).execution
    ?.revision;
  return typeof revision === 'string' && /^[0-9a-fA-F]{40}$/.test(revision)
    ? revision.toLowerCase()
    : null;
}
