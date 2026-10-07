import type { ResolvedRuntimeProfile } from '@themoltnet/agent-runtime';
import {
  createPiRetryTriage,
  resolveRuntimeProfileModel,
} from '@themoltnet/pi-runtime';

import type { RetryTriage } from './retry-triage.js';

export function createRuntimeProfileRetryTriage(options: {
  runtimeProfile: Pick<ResolvedRuntimeProfile, 'models'>;
  piAgentDir: string;
  timeoutMs?: number;
  cwd?: string;
}): RetryTriage | undefined {
  const generation = options.runtimeProfile.models.generation;
  if (!generation) return undefined;
  return async (input) => {
    const { modelHandle, modelRuntime } = await resolveRuntimeProfileModel(
      options.piAgentDir,
      generation.provider,
      generation.model,
    );
    return createPiRetryTriage({
      model: modelHandle,
      modelRuntime,
      thinkingLevel: generation.thinkingLevel,
      piAgentDir: options.piAgentDir,
      timeoutMs: options.timeoutMs,
      cwd: options.cwd,
    })(input);
  };
}
