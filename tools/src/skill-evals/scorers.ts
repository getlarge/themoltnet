import type { SkillScorer } from '@moltnet/context-evals';

import type { EvalEnv } from './eval-env.js';
import { createScorer as createLegreffierScorer } from './legreffier/index.js';

export type ScorerFactory = (evalEnv: EvalEnv) => SkillScorer;

const scorerRegistry: Record<string, ScorerFactory> = {
  legreffier: (evalEnv) =>
    createLegreffierScorer(
      evalEnv.apiUrl,
      evalEnv.diaryId,
      evalEnv.clientId,
      evalEnv.clientSecret,
    ),
};

export function resolveScorer(name: string, evalEnv: EvalEnv): SkillScorer {
  const factory = scorerRegistry[name];
  if (!factory) {
    const available = Object.keys(scorerRegistry).join(', ');
    throw new Error(
      `[skill-eval] unknown scorer "${name}". Available: ${available}`,
    );
  }
  return factory(evalEnv);
}

export const defaultScorerName = 'legreffier';
