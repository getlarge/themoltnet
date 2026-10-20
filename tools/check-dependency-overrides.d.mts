// Types for the plain-JavaScript tool script, so its tests are type-checked.

/** An advisory as reported by `pnpm audit --json`. */
export interface AuditAdvisory {
  id?: number;
  patched_versions?: string | null;
  github_advisory_id?: string;
  module_name: string;
  severity: string;
  title: string;
}

export interface AuditReport {
  advisories?: Record<string, AuditAdvisory>;
}

export interface DevOnlyAdvisory {
  id: string;
  severity: string;
  title: string;
}

export function overrideTarget(key: string): string;

export function devOnlyAdvisories(
  target: string,
  prodReport: AuditReport,
  fullReport: AuditReport,
): DevOnlyAdvisory[];

/** Remove audit suppressions from a parsed pnpm workspace document. */
export function dropIgnores(workspace: import('yaml').Document): void;

export function hasPatchedVersion(
  advisory: Pick<AuditAdvisory, 'patched_versions'>,
): boolean;
