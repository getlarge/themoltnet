import { randomUUID } from 'node:crypto';

export interface DaemonSlotIdentity {
  agentName: string;
  runtimeProfileId: string;
  /**
   * Process-lifetime discriminator. Correlation keys remain the logical warm
   * session identity, while this component prevents concurrent daemon
   * processes from opening the same local Pi session directory.
   */
  runtimeInstanceId?: string;
}

export function createRuntimeInstanceId(): string {
  return randomUUID();
}
