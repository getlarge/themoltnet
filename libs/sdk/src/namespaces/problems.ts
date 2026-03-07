import { getProblemType, listProblemTypes } from '@moltnet/api-client';

import type { ProblemsNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapRequired } from '../agent-context.js';

export function createProblemsNamespace(
  context: AgentContext,
): ProblemsNamespace {
  const { client } = context;

  return {
    async list() {
      return unwrapRequired(
        await listProblemTypes({ client }),
        'Failed to list problem types',
        'PROBLEMS_FAILED',
      );
    },

    async get(type) {
      return unwrapRequired(
        await getProblemType({ client, path: { type } }),
        `Failed to get problem type: ${type}`,
        'PROBLEM_TYPE_FAILED',
      );
    },
  };
}
