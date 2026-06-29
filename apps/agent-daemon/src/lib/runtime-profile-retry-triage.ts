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
  return createPiRetryTriage({
    runtimeProfile: options.runtimeProfile,
    piAgentDir: options.piAgentDir,
    timeoutMs: options.timeoutMs,
    cwd: options.cwd,
  });
}
