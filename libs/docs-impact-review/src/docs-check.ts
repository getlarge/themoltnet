import { truncateAtLine } from './text.js';
import type { DiffBlock, DocsFinding } from './types.js';

/** Added or rewritten documentation text, judged on its own. */
export interface DocsHunk {
  /** `<path>#<n>`, stable within one review. */
  id: string;
  path: string;
  /** Nearest Markdown heading before the added text, when one is visible. */
  section?: string;
  /** Added lines only, without diff markers. */
  added: string;
}

export const DOCS_CHECK_VERDICTS = ['keep', 'rewrite', 'remove'] as const;
export type DocsCheckVerdict = (typeof DOCS_CHECK_VERDICTS)[number];

export interface DocsCheckAnswer {
  id: string;
  verdict: DocsCheckVerdict;
  reason: string;
}

const HEADER = /^### (\S+) \(/;
const HEADING = /^#{1,6}\s+\S/;

/**
 * Splits docs diff blocks into hunks of added text. Removed-only hunks are
 * skipped: deleting documentation is not something this check judges.
 */
export function extractDocsHunks(
  blocks: readonly DiffBlock[],
  limits: { maxHunks: number; maxBytesPerHunk: number },
): { hunks: DocsHunk[]; overflow: string[] } {
  const hunks: DocsHunk[] = [];
  const overflow: string[] = [];
  for (const block of blocks) {
    if (block.category !== 'docs') continue;
    const lines = block.text.split('\n');
    const path = HEADER.exec(lines[0] ?? '')?.[1];
    if (!path) continue;
    let index = 0;
    let section: string | undefined;
    let current: { section?: string; added: string[] } | undefined;
    const flush = () => {
      if (!current) return;
      const added = current.added.join('\n').trim();
      if (added.length > 0) {
        index += 1;
        const id = `${path}#${index}`;
        if (hunks.length >= limits.maxHunks) {
          overflow.push(id);
        } else {
          hunks.push({
            id,
            path,
            ...(current.section ? { section: current.section } : {}),
            added: truncateAtLine(added, limits.maxBytesPerHunk),
          });
        }
      }
      current = undefined;
    };
    for (const line of lines.slice(1)) {
      if (line.startsWith('@@')) {
        flush();
        current = { section, added: [] };
        continue;
      }
      if (!current) continue;
      if (line.startsWith('+')) {
        const text = line.slice(1);
        if (HEADING.test(text)) section = text.trim();
        if (current.added.length === 0 && !current.section && section) {
          current.section = section;
        }
        current.added.push(text);
      } else if (line.startsWith(' ')) {
        const text = line.slice(1);
        if (HEADING.test(text)) {
          section = text.trim();
          if (current.added.length === 0) current.section = section;
        }
      }
    }
    flush();
  }
  return { hunks, overflow };
}

/**
 * Trusted conversion of per-hunk verdicts into findings. `keep` produces
 * nothing; unanswered hunks are returned so callers can record them as gaps.
 */
export function docsCheckFindings(
  hunks: readonly DocsHunk[],
  answers: readonly DocsCheckAnswer[],
): { findings: DocsFinding[]; unanswered: string[] } {
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  const findings: DocsFinding[] = [];
  const unanswered: string[] = [];
  for (const hunk of hunks) {
    const answer = byId.get(hunk.id);
    if (!answer) {
      unanswered.push(hunk.id);
      continue;
    }
    if (answer.verdict === 'keep') continue;
    findings.push({
      changeId: `docs:${hunk.path}`,
      issue: 'unnecessary',
      evidence: { path: hunk.path, detail: answer.reason },
      docsPath: hunk.path,
      ...(hunk.section ? { section: hunk.section } : {}),
      update: `${answer.verdict === 'remove' ? 'Remove' : 'Rewrite'} this addition: ${answer.reason}`,
    });
  }
  return { findings, unanswered };
}
