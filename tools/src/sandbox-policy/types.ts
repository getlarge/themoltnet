export const ENFORCEMENT_STATES = [
  'enforced',
  'unsupported',
  'degraded',
  'failed-open',
  'failed',
] as const;

export type EnforcementState = (typeof ENFORCEMENT_STATES)[number];

export const EVIDENCE_BASES = ['declared', 'applied', 'verified'] as const;

export type EvidenceBasis = (typeof EVIDENCE_BASES)[number];

export type ControlDomain =
  | 'filesystem'
  | 'network'
  | 'credential'
  | 'lifecycle'
  | 'resource'
  | 'topology';

export interface SandboxScenario {
  id: string;
  domain: ControlDomain;
  control: string;
  purpose: string;
  required: boolean;
  oracle: string;
}

export interface ScenarioCatalog {
  schemaVersion: 1;
  catalogVersion: string;
  notice: string;
  scenarios: SandboxScenario[];
}

/** Portable, value-free containment intent exercised by one scenario. */
export interface ContainmentIntent {
  scenarioId: string;
  domain: ControlDomain;
  control: string;
  required: boolean;
  parameters?: Record<string, unknown>;
}

/** Backend-specific resolution. Values must remain credential-free. */
export interface AdapterResolution {
  backendId: string;
  requested: ContainmentIntent;
  effective: Record<string, unknown>;
  binding?: Record<string, unknown>;
  fidelity?: string;
  mandatoryEffects?: string[];
}

export interface BackendInventory {
  id: string;
  version: string;
  runtime?: string;
  runtimeVersion?: string;
  os: string;
  architecture: string;
  topology: string[];
}

export interface ControlOracle {
  kind: string;
  expected: unknown;
  observed: unknown;
  passed: boolean;
}

export interface PersistentMutationEvidence {
  kind: string;
  resource: string;
  cleanup: 'pending' | 'cleaned' | 'residue';
  reason?: string;
}

export interface ControlEvidence {
  scenarioId: string;
  requestedIntent: ContainmentIntent;
  resolvedAdapterConfig: AdapterResolution | null;
  backend: Pick<BackendInventory, 'id' | 'version'>;
  enforcementLocus: string[];
  state: EnforcementState;
  basis: EvidenceBasis;
  oracle: ControlOracle | null;
  reasonCode: string;
  recordedAt: string;
  persistentMutations: PersistentMutationEvidence[];
  notes?: string[];
}

export interface HostCapabilityEvidence {
  id: string;
  locus: 'host' | 'control-plane';
  relationship: 'outside-containment' | 'mediates-containment';
  basis: EvidenceBasis;
  description: string;
}

export interface AgentSmokeEvidence {
  backendId: string;
  status: 'passed' | 'failed' | 'skipped';
  provider: string;
  model?: string;
  reasonCode: string;
  wallTimeMs: number;
  notes: string[];
}

export interface SandboxProbeRun {
  schemaVersion: 1;
  catalogVersion: string;
  runId: string;
  sourceRevision: string;
  recordedAt: string;
  backend: BackendInventory;
  controls: ControlEvidence[];
  hostCapabilities: HostCapabilityEvidence[];
  agentSmoke?: AgentSmokeEvidence;
  cleanupComplete: boolean;
}

export interface ProbeContext {
  runId: string;
  recordedAt: () => string;
  probeRoot: string;
}

export interface ResearchSandboxAdapter {
  inspect(): Promise<BackendInventory>;
  runScenario(
    scenario: SandboxScenario,
    context: ProbeContext,
  ): Promise<ControlEvidence>;
  hostCapabilities(): Promise<HostCapabilityEvidence[]>;
  close(): Promise<PersistentMutationEvidence[]>;
}
