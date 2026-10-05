import { posix } from 'node:path';

import { type Static, Type } from 'typebox';

import type { Git } from './git.js';
import { matchesAny } from './glob.js';
import { type DocsGlobs, isDocsPath } from './ingest.js';
import type { ChangedFile, DocsSelectionReason } from './types.js';

export const RoutingRule = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    paths: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    docs: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  },
  { additionalProperties: false },
);

export type RoutingRule = Static<typeof RoutingRule>;

/** The configured routing rules; validated with the repository config. */
export interface RoutingMap {
  rules: RoutingRule[];
}

export interface RoutedDocs {
  candidates: Map<string, DocsSelectionReason[]>;
  /** Source files no rule or README owns; these rely on symbol search. */
  unroutedSources: string[];
}

function addReason(
  candidates: Map<string, DocsSelectionReason[]>,
  path: string,
  reason: DocsSelectionReason,
): void {
  const reasons = candidates.get(path) ?? [];
  if (!reasons.includes(reason)) reasons.push(reason);
  candidates.set(path, reasons);
}

/** Nearest README.md in an ancestor directory, excluding the repository root. */
function nearestReadme(
  path: string,
  readmeExists: (path: string) => boolean,
): string | undefined {
  for (let dir = posix.dirname(path); dir !== '.'; dir = posix.dirname(dir)) {
    const candidate = `${dir}/README.md`;
    if (readmeExists(candidate)) return candidate;
  }
  return undefined;
}

export function routeDocs(
  files: readonly ChangedFile[],
  map: RoutingMap,
  readmeExists: (path: string) => boolean,
): RoutedDocs {
  const candidates = new Map<string, DocsSelectionReason[]>();
  const unroutedSources: string[] = [];
  for (const file of files) {
    if (file.category === 'docs') {
      addReason(candidates, file.path, 'changed-in-pr');
      continue;
    }
    if (file.category !== 'source') continue;
    let routed = false;
    for (const rule of map.rules) {
      if (matchesAny(file.path, rule.paths)) {
        for (const doc of rule.docs) addReason(candidates, doc, 'routing-map');
        routed = true;
      }
    }
    const readme = nearestReadme(file.path, readmeExists);
    if (readme) {
      addReason(candidates, readme, 'nearest-readme');
      routed = true;
    }
    if (!routed) unroutedSources.push(file.path);
  }
  return { candidates, unroutedSources };
}

const MIN_TERM_LENGTH = 3;
const MAX_TERM_LENGTH = 80;
/** Literal paths per `git grep`, far below any argument-length limit. */
const PATHSPEC_CHUNK = 500;

/**
 * Pathspec groups to search. Markdown alone is two git globs. Repository
 * `include` globs use minimatch syntax (braces, dot rules) that git
 * pathspecs do not share, so the documentation files are listed once and
 * passed as literal paths instead.
 */
function docsPathspecs(
  git: Git,
  headRevision: string,
  docs: DocsGlobs,
): string[][] {
  // `top`: search the whole tree whatever the working directory.
  if (docs.include.length === 0) return [[':(top)*.md', ':(top)*.mdx']];
  const paths = git([
    'ls-tree',
    '-r',
    '-z',
    '--full-tree',
    '--name-only',
    headRevision,
  ])
    .split('\0')
    .filter(
      (path) =>
        path !== '' &&
        isDocsPath(path, docs.include) &&
        !matchesAny(path, docs.exclude),
    )
    .map((path) => `:(top,literal)${path}`);
  const groups: string[][] = [];
  for (let start = 0; start < paths.length; start += PATHSPEC_CHUNK) {
    groups.push(paths.slice(start, start + PATHSPEC_CHUNK));
  }
  return groups;
}

/**
 * One exact, fixed-string search over documentation at the head revision.
 * Model proposed terms are data: they are passed to `git grep -F` as
 * patterns and never interpreted as regular expressions or shell.
 */
export function searchDocsForTerms(
  git: Git,
  headRevision: string,
  terms: readonly string[],
  docs: DocsGlobs,
): Map<string, string[]> {
  const usable = [
    ...new Set(
      terms
        .map((term) => term.trim())
        .filter(
          (term) =>
            term.length >= MIN_TERM_LENGTH &&
            term.length <= MAX_TERM_LENGTH &&
            !/[\r\n]/.test(term),
        ),
    ),
  ];
  const hits = new Map<string, string[]>();
  if (usable.length === 0) return hits;
  // One `-l` search per term: output is one path per matching file, so it
  // stays small however often a term occurs, and per-term file counts (used
  // to drop generic terms) are exact.
  const prefix = `${headRevision}:`;
  const groups = docsPathspecs(git, headRevision, docs);
  for (const term of usable) {
    for (const pathspecs of groups) {
      let output: string;
      try {
        output = git([
          'grep',
          '-I',
          '-F',
          '-l',
          // Root-relative output, matching every other path in the review.
          '--full-name',
          '-e',
          term,
          headRevision,
          '--',
          ...pathspecs,
        ]);
      } catch (error) {
        // `git grep` exits 1 when nothing matches.
        if ((error as { status?: number }).status === 1) continue;
        throw error;
      }
      for (const line of output.split('\n')) {
        if (!line.startsWith(prefix)) continue;
        const path = line.slice(prefix.length);
        // Filtered here rather than with pathspec excludes, so search
        // applies the same glob semantics as ingestion and selection.
        if (matchesAny(path, docs.exclude)) continue;
        const terms = hits.get(path) ?? [];
        if (!terms.includes(term)) terms.push(term);
        hits.set(path, terms);
      }
    }
  }
  return hits;
}

/** A search term matching more documentation files than this is too generic. */
export const MAX_FILES_PER_TERM = 8;

/**
 * Drops search terms that match too many files (e.g. `--help`): they flood
 * selection with unrelated pages and push relevant ones out.
 */
export function dropGenericTerms(
  hits: ReadonlyMap<string, string[]>,
  maxFilesPerTerm = MAX_FILES_PER_TERM,
): { hits: Map<string, string[]>; generic: string[] } {
  const filesPerTerm = new Map<string, number>();
  for (const terms of hits.values()) {
    for (const term of terms) {
      filesPerTerm.set(term, (filesPerTerm.get(term) ?? 0) + 1);
    }
  }
  const generic = [...filesPerTerm.entries()]
    .filter(([, count]) => count > maxFilesPerTerm)
    .map(([term]) => term)
    .sort();
  const kept = new Map<string, string[]>();
  for (const [path, terms] of hits) {
    const specific = terms.filter((term) => !generic.includes(term));
    if (specific.length > 0) kept.set(path, specific);
  }
  return { hits: kept, generic };
}

/** Agent-facing instructions rank below user or operator docs. */
const AGENT_FACING_PENALTY = 3;

/**
 * Drops candidates the repository excludes. Routing rules and nearest READMEs
 * can still name an excluded page; changed docs are already categorized away.
 */
export function excludeCandidates(
  candidates: Map<string, DocsSelectionReason[]>,
  exclude: readonly string[],
): void {
  for (const path of candidates.keys()) {
    if (matchesAny(path, exclude)) candidates.delete(path);
  }
}

/** Candidates that must be reviewed; overflowing them is a coverage gap. */
export function isRequiredCandidate(reasons: DocsSelectionReason[]): boolean {
  return reasons.includes('changed-in-pr') || reasons.includes('routing-map');
}

const REASON_WEIGHT: Record<DocsSelectionReason, number> = {
  'changed-in-pr': 8,
  'routing-map': 4,
  'symbol-search': 2,
  'nearest-readme': 1,
};

export interface DocsSelection {
  selected: Array<{ path: string; reasons: DocsSelectionReason[] }>;
  overflow: Array<{ path: string; reasons: DocsSelectionReason[] }>;
}

/**
 * The one candidate pipeline for reviews and dry runs: drop what the
 * repository excludes, then rank within the budget.
 */
export function selectCandidates(
  candidates: Map<string, DocsSelectionReason[]>,
  docs: { docsExclude: readonly string[]; agentFacing: readonly string[] },
  maxDocs: number,
): DocsSelection {
  excludeCandidates(candidates, docs.docsExclude);
  return selectDocs(candidates, maxDocs, docs.agentFacing);
}

export function selectDocs(
  candidates: ReadonlyMap<string, DocsSelectionReason[]>,
  maxDocs: number,
  agentFacing: readonly string[],
): DocsSelection {
  const ranked = [...candidates.entries()]
    .map(([path, reasons]) => ({
      path,
      reasons,
      score:
        reasons.reduce((sum, reason) => sum + REASON_WEIGHT[reason], 0) -
        (matchesAny(path, agentFacing) && !isRequiredCandidate(reasons)
          ? AGENT_FACING_PENALTY
          : 0),
    }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return {
    selected: ranked
      .slice(0, maxDocs)
      .map(({ path, reasons }) => ({ path, reasons })),
    overflow: ranked
      .slice(maxDocs)
      .map(({ path, reasons }) => ({ path, reasons })),
  };
}
