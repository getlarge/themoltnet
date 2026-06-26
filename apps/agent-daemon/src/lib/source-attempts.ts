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
  };
}

function resolveOutputBranch(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null;
  const branch = (output as { branch?: unknown }).branch;
  return typeof branch === 'string' && branch.length > 0 ? branch : null;
}
