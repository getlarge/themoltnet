import type { AgentServerProvider } from '@moltnet/agent-daemon-api-client';
export type { AgentServerProvider } from '@moltnet/agent-daemon-api-client';

export interface ProviderActions {
  putProvider(
    providerId: string,
    config: {
      api: string;
      baseUrl: string;
      envName: string;
      models: AgentServerProvider['models'];
      /** Write-only: the server never echoes it back. */
      apiKey?: string;
    },
  ): Promise<AgentServerProvider>;
  deleteProvider(providerId: string): Promise<void>;
  discoverModels(providerId: string): Promise<AgentServerProvider['models']>;
}
