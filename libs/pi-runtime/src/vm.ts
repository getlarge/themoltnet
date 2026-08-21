import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  type ManagedVm,
  type ProviderAuthSource,
  resumeVm as resumeSandboxVm,
  type VmConfig,
} from '@themoltnet/sandbox-gondolin';

import { resolvePiCodingAgentDir } from './config.js';

/** Guest path where Pi expects its auth blob. */
export const PI_GUEST_AUTH_PATH = '/home/agent/.pi/agent/auth.json';

/**
 * Pi's provider authentication as a sandbox `ProviderAuthSource`. CI writes
 * `auth.json` under `PI_CODING_AGENT_DIR`; local runs fall back to the
 * canonical `~/.pi/agent` dir when the override is unset.
 */
export function piProviderAuth(): ProviderAuthSource {
  return {
    guestPath: PI_GUEST_AUTH_PATH,
    load: () => {
      const authPath = path.join(resolvePiCodingAgentDir(), 'auth.json');
      return existsSync(authPath) ? readFileSync(authPath, 'utf8') : null;
    },
  };
}

/**
 * Resume a Gondolin VM for a Pi session. Identical to the sandbox package's
 * `resumeVm`, with Pi's provider auth supplied unless the caller overrides it.
 */
export function resumeVm(config: VmConfig): Promise<ManagedVm> {
  return resumeSandboxVm({ providerAuth: piProviderAuth(), ...config });
}
