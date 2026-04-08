import type { AgentType } from '../ui/types.js';

export interface AgentAdapterOptions {
  repoDir: string;
  agentName: string;
  prefix: string;
  mcpUrl: string;
  clientId: string;
  clientSecret: string;
  appSlug: string;
  appId: string;
  pemPath: string;
  installationId: string;
}

export interface AgentAdapter {
  readonly type: AgentType;
  writeMcpConfig(opts: AgentAdapterOptions): Promise<void>;
  writeSkills(repoDir: string): Promise<void>;
  writeSettings(opts: AgentAdapterOptions): Promise<void>;
  writeRules(opts: AgentAdapterOptions): Promise<void>;
}
