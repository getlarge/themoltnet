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

// Max title (255) + newline (1) + max content (100_000) = 100_256
const MAX_SCAN_LENGTH = 100_256;

// Some built-in vard patterns backtrack over a whole run of word characters
// or `#`, so their cost grows with the square of the run length. Runs are
// shortened before scanning. A shortened run keeps its first characters and
// is still followed by the non-word character that ended it, so word
// boundaries do not move, and the kept length exceeds every bounded
// quantifier in the patterns (`\w{3,20}`, `{40,}`, `#{1,6}`). Detection is
// unchanged; only the text recorded in a threat's `match` can get shorter.
const MAX_WORD_RUN = 64;
const MAX_HASH_RUN = 7;
const LONG_WORD_RUN = new RegExp(`\\w{${MAX_WORD_RUN + 1},}`, 'g');
const LONG_HASH_RUN = new RegExp(`#{${MAX_HASH_RUN + 1},}`, 'g');

function boundRuns(text: string): string {
  return text
    .replace(LONG_WORD_RUN, (run) => run.slice(0, MAX_WORD_RUN))
    .replace(LONG_HASH_RUN, '#'.repeat(MAX_HASH_RUN));
}

// Configure scanner: moderate threshold (0.7), bounded input
const scanner = vard.moderate().maxLength(MAX_SCAN_LENGTH);

export function scanForInjection(
  content: string,
  title?: string | null,
): ScanResult {
  const text = title ? `${title}\n${content}` : content;

  // Checked on the original text: bounding runs shortens it.
  if (text.length > MAX_SCAN_LENGTH) {
    return {
      injectionRisk: true,
      threats: [
        {
          type: 'instructionOverride',
          severity: 0.8,
          match: `Input exceeds ${MAX_SCAN_LENGTH} characters`,
        },
      ],
    };
  }

  const result = scanner.safeParse(boundRuns(text));

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
