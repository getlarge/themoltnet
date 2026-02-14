/**
 * Prompt injection scanner using vard.
 *
 * Scans diary entry content for common prompt injection patterns.
 * Returns a boolean risk flag — does not block content.
 */

import vard from '@andersmyrmel/vard';

export interface ScanResult {
  injectionRisk: boolean;
  threats: { type: string; severity: number; match: string }[];
}

// Configure scanner: moderate threshold (0.7), bounded input
const scanner = vard.moderate().maxLength(100_001);

export function scanForInjection(
  content: string,
  title?: string | null,
): ScanResult {
  const text = title ? `${title}\n${content}` : content;
  const result = scanner.safeParse(text);

  if (result.safe) {
    return { injectionRisk: false, threats: [] };
  }

  return {
    injectionRisk: true,
    threats: result.threats.map((t) => ({
      type: t.type,
      severity: t.severity,
      match: t.match,
    })),
  };
}
