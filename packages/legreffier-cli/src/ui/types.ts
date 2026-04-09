export const SUPPORTED_AGENTS = ['claude', 'codex'] as const;
export type AgentType = (typeof SUPPORTED_AGENTS)[number];

export type StepKey =
  | 'keypair'
  | 'register'
  | 'githubApp'
  | 'gitSetup'
  | 'installation'
  | 'skills'
  | 'settings';

export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

export type UIPhase =
  | 'disclaimer'
  | 'agent_select'
  | 'identity'
  | 'github_app'
  | 'git_setup'
  | 'installation'
  | 'agent_setup'
  | 'done'
  | 'error';

export interface UISummary {
  agentName: string;
  fingerprint: string;
  appSlug: string;
  apiUrl: string;
  mcpUrl: string;
}

import type { OnboardingStatus } from '../api.js';

export interface UIState {
  phase: UIPhase;
  agentName: string;
  fingerprint?: string;
  appSlug?: string;
  serverStatus?: OnboardingStatus;
  manifestFormUrl?: string;
  installationUrl?: string;
  summary?: UISummary;
  errorMessage?: string;
  steps: Record<StepKey, StepStatus>;
}

export type UIAction =
  | { type: 'step'; key: StepKey; status: StepStatus }
  | { type: 'phase'; phase: UIPhase }
  | { type: 'fingerprint'; fingerprint: string }
  | { type: 'appSlug'; appSlug: string }
  | { type: 'serverStatus'; status: OnboardingStatus }
  | { type: 'manifestFormUrl'; url: string }
  | { type: 'installationUrl'; url: string }
  | { type: 'summary'; summary: UISummary }
  | { type: 'error'; message: string };

// Phase result types
export interface IdentityResult {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
  workflowId: string;
  manifestFormUrl: string;
  clientId: string;
  clientSecret: string;
  skipped: boolean;
}

export interface GithubAppResult {
  appId: string;
  appSlug: string;
  pemPath: string;
  installationId: string;
  skipped: boolean;
}

export interface InstallationResult {
  installationId: string;
  identityId: string;
  clientId: string;
  clientSecret: string;
}
