import { randomUUID } from 'node:crypto';

export interface DaemonSlotIdentity {
  agentName: string;
  runtimeProfileId: string;
  /**
   * Process-lifetime discriminator for workspace ownership and cleanup.
   * Conversation identity belongs to the Durable attempt store.
   */
  runtimeInstanceId?: string;
}

export function createRuntimeInstanceId(): string {
  return randomUUID();
}
