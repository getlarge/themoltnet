import { type Api, getModel, type Model } from '@earendil-works/pi-ai';
import { createPiRetryTriage } from '@themoltnet/pi-extension';

import type { RetryTriage } from './retry-triage.js';
import type { ResolvedRuntimeProfile } from './runtime-profile.js';

export function createRuntimeProfileRetryTriage(options: {
  runtimeProfile: Pick<
    ResolvedRuntimeProfile,
    'provider' | 'model' | 'thinkingLevel'
  >;
  piAgentDir: string;
  timeoutMs?: number;
  cwd?: string;
}): RetryTriage {
  const getModelLoose = getModel as unknown as (
    provider: string,
    modelId: string,
  ) => Model<Api>;
  const model = getModelLoose(
    options.runtimeProfile.provider,
    options.runtimeProfile.model,
  );
  return createPiRetryTriage({
    model,
    thinkingLevel: options.runtimeProfile.thinkingLevel,
    piAgentDir: options.piAgentDir,
    timeoutMs: options.timeoutMs,
    cwd: options.cwd,
  });
}
