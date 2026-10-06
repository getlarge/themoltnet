import { posix } from 'node:path';

import { type Static, Type } from 'typebox';

import {
  type DocsGlobs,
  isReviewableDocsPath,
  MARKDOWN_PATHSPECS,
} from './docs-paths.js';
import type { Git } from './git.js';
import { matchesAny } from './glob.js';
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
 * Included documentation files searched at most. The head tree is the pull
 * request's, so without a cap a PR adding thousands of matching files would
 * turn search into thousands of `git grep` calls instead of a coverage gap.
 */
export const MAX_SEARCHED_INCLUDED_DOCS = 2_000;

export interface DocsSearch {
  /** Path → the terms found in it. */
  hits: Map<string, string[]>;
  /** Included documentation files left unsearched by the cap. */
  unsearched: number;
}

function literalChunks(paths: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let start = 0; start < paths.length; start += PATHSPEC_CHUNK) {
    chunks.push(
      paths
        .slice(start, start + PATHSPEC_CHUNK)
        .map((path) => `:(top,literal)${path}`),
    );
  }
  return chunks;
}

/**
 * Pathspec groups to search. Markdown alone is two git globs. Repository
 * `include` globs use minimatch syntax (braces, dot rules) that git
 * pathspecs do not share, so the documentation files are listed once and
 * passed as literal paths instead, up to `MAX_SEARCHED_INCLUDED_DOCS`.
 */
function docsPathspecs(
  git: Git,
  headRevision: string,
  docs: DocsGlobs,
  maxIncluded: number,
): { groups: string[][]; unsearched: number } {
  if (docs.include.length === 0) {
    return { groups: [[...MARKDOWN_PATHSPECS]], unsearched: 0 };
  }
  const paths = git([
    'ls-tree',
    '-r',
    '-z',
    '--full-tree',
    '--name-only',
    headRevision,
  ])
    .split('\0')
    .filter((path) => path !== '' && isReviewableDocsPath(path, docs));
  return {
    groups: literalChunks(paths.slice(0, maxIncluded)),
    unsearched: Math.max(0, paths.length - maxIncluded),
  };
}

/** Files at `headRevision` holding any of `terms`, root-relative. */
function grepFiles(
  git: Git,
  headRevision: string,
  terms: readonly string[],
  pathspecs: readonly string[],
): string[] {
  let output: string;
  try {
    output = git([
      'grep',
      '-I',
      '-F',
      '-l',
      // Root-relative output, matching every other path in the review.
      '--full-name',
      ...terms.flatMap((term) => ['-e', term]),
      headRevision,
      '--',
      ...pathspecs,
    ]);
  } catch (error) {
    // `git grep` exits 1 when nothing matches.
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
  const prefix = `${headRevision}:`;
  return output
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
}

/**
 * Exact, fixed-string search over documentation at the head revision.
 * Model proposed terms are data: they are passed to `git grep -F` as
 * patterns and never interpreted as regular expressions or shell.
 *
 * One search for all terms finds the candidate files; each term is then
 * searched in those candidates only, so per-term file counts (used to drop
 * generic terms) are exact without one full-tree search per term.
 */
export function searchDocsForTerms(
  git: Git,
  headRevision: string,
  terms: readonly string[],
  docs: DocsGlobs,
  maxIncluded = MAX_SEARCHED_INCLUDED_DOCS,
): DocsSearch {
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
  if (usable.length === 0) return { hits, unsearched: 0 };
  const { groups, unsearched } = docsPathspecs(
    git,
    headRevision,
    docs,
    maxIncluded,
  );
  // Filtered here rather than with pathspec excludes, so search applies the
  // same glob semantics as ingestion and selection.
  const candidates = [
    ...new Set(
      groups.flatMap((pathspecs) =>
        grepFiles(git, headRevision, usable, pathspecs),
      ),
    ),
  ]
    .filter((path) => isReviewableDocsPath(path, docs))
    .sort();
  if (candidates.length === 0) return { hits, unsearched };
  const candidateChunks = literalChunks(candidates);
  for (const term of usable) {
    for (const pathspecs of candidateChunks) {
      for (const path of grepFiles(git, headRevision, [term], pathspecs)) {
        const found = hits.get(path) ?? [];
        if (!found.includes(term)) found.push(term);
        hits.set(path, found);
      }
    }
  }
  return { hits, unsearched };
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
