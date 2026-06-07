import type { LifecyclePhase, LifecycleStateArtifact } from './types.js';

const PHASES = new Set<LifecyclePhase>([
  'triaging',
  'classified',
  'plan_generated',
  'approved',
  'implementing',
  'pr_open',
  'pr_failed',
  'releasing',
  'notify',
  'done',
]);

interface FreeformArtifact {
  kind?: unknown;
  body?: unknown;
}

interface FreeformOutput {
  artifacts?: unknown;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      'issue_lifecycle_state artifact body must be a JSON object',
    );
  }
  return parsed as Record<string, unknown>;
}

function normalizeFinding(finding: unknown): string | null {
  if (typeof finding === 'string') {
    const trimmed = finding.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (
    typeof finding !== 'object' ||
    finding === null ||
    Array.isArray(finding)
  ) {
    return null;
  }

  const record = finding as Record<string, unknown>;
  const fields = [
    record.id,
    record.priority ?? record.severity,
    record.description ?? record.problem,
    record.requiredChange ?? record.suggestedAction,
    record.fileOrArea ?? record.area,
  ]
    .filter((field): field is string => typeof field === 'string')
    .map((field) => field.trim())
    .filter((field) => field.length > 0);

  return fields.length > 0 ? fields.join(' - ') : null;
}

export function parseLifecycleStateArtifact(
  output: unknown,
): LifecycleStateArtifact {
  const artifacts =
    typeof output === 'object' && output !== null
      ? (output as FreeformOutput).artifacts
      : undefined;
  if (!Array.isArray(artifacts)) {
    throw new Error('freeform output does not contain artifacts[]');
  }

  const artifact = artifacts.find(
    (candidate): candidate is FreeformArtifact =>
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as FreeformArtifact).kind === 'issue_lifecycle_state',
  );
  if (!artifact || typeof artifact.body !== 'string') {
    throw new Error(
      'freeform output is missing an issue_lifecycle_state artifact body',
    );
  }

  const body = parseJsonObject(artifact.body);
  const phase = body.phase;
  const decision = body.decision;
  const summary = body.summary;

  if (typeof phase !== 'string' || !PHASES.has(phase as LifecyclePhase)) {
    throw new Error(`invalid issue lifecycle phase: ${String(phase)}`);
  }
  if (typeof decision !== 'string' || decision.length === 0) {
    throw new Error('issue lifecycle artifact decision must be a string');
  }
  if (typeof summary !== 'string' || summary.length === 0) {
    throw new Error('issue lifecycle artifact summary must be a string');
  }

  const state: LifecycleStateArtifact = {
    phase: phase as LifecyclePhase,
    decision,
    summary,
  };

  if (Array.isArray(body.findings)) {
    state.findings = body.findings.flatMap((finding) => {
      const normalized = normalizeFinding(finding);
      return normalized ? [normalized] : [];
    });
  }
  if (typeof body.plan === 'string') state.plan = body.plan;
  if (typeof body.prNumber === 'number') state.prNumber = body.prNumber;
  if (typeof body.prUrl === 'string') state.prUrl = body.prUrl;
  if (typeof body.notifySkipped === 'boolean') {
    state.notifySkipped = body.notifySkipped;
  }

  return state;
}

export function isReviewPassed(state: LifecycleStateArtifact): boolean {
  return (
    state.phase === 'plan_generated' &&
    ['review_passed', 'no_findings', 'approve'].includes(state.decision) &&
    (!state.findings || state.findings.length === 0)
  );
}
