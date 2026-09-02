import type { ResolvedRuntimeProfile } from '@themoltnet/agent-runtime';
import {
  createPiRetryTriage,
  resolveRuntimeProfileModel,
} from '@themoltnet/pi-runtime';

import type { RetryTriage } from './retry-triage.js';

export function createRuntimeProfileRetryTriage(options: {
  runtimeProfile: Pick<
    ResolvedRuntimeProfile,
    'provider' | 'model' | 'thinkingLevel'
  >;
  piAgentDir: string;
  timeoutMs?: number;
  cwd?: string;
}): RetryTriage {
  return async (input) => {
    const { modelHandle, modelRuntime } = await resolveRuntimeProfileModel(
      options.piAgentDir,
      options.runtimeProfile.provider,
      options.runtimeProfile.model,
    );
    return createPiRetryTriage({
      model: modelHandle,
      modelRuntime,
      thinkingLevel: options.runtimeProfile.thinkingLevel,
      piAgentDir: options.piAgentDir,
      timeoutMs: options.timeoutMs,
      cwd: options.cwd,
    })(input);
  };
}
