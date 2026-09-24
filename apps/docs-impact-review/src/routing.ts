import { posix } from 'node:path';

import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';

import type { Git } from './git.js';
import type { ChangedFile, DocsSelectionReason } from './types.js';

const RoutingRule = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    paths: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    docs: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  },
  { additionalProperties: false },
);

const RoutingMap = Type.Object(
  {
    version: Type.Literal(1),
    rules: Type.Array(RoutingRule),
  },
  { additionalProperties: false },
);
export type RoutingMap = Static<typeof RoutingMap>;

export function parseRoutingMap(value: unknown): RoutingMap {
  if (!Value.Check(RoutingMap, value)) {
    const [first] = Value.Errors(RoutingMap, value);
    throw new Error(
      `invalid docs routing map at ${first?.instancePath || '(root)'}: ${first?.message}`,
    );
  }
  return value;
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
      if (rule.paths.some((glob) => posix.matchesGlob(file.path, glob))) {
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

/**
 * One exact, fixed-string search over Markdown at the head revision. Model
 * proposed terms are data: they are passed to `git grep -F` as patterns and
 * never interpreted as regular expressions or shell.
 */
export function searchDocsForTerms(
  git: Git,
  headRevision: string,
  terms: readonly string[],
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
  let output: string;
  try {
    output = git([
      'grep',
      '-I',
      '-F',
      '-o',
      ...usable.flatMap((term) => ['-e', term]),
      headRevision,
      '--',
      '*.md',
      '*.mdx',
      ':(exclude,glob)**/CHANGELOG.md',
    ]);
  } catch (error) {
    // `git grep` exits 1 when nothing matches.
    if ((error as { status?: number }).status === 1) return hits;
    throw error;
  }
  const prefix = `${headRevision}:`;
  for (const line of output.split('\n')) {
    if (!line.startsWith(prefix)) continue;
    const rest = line.slice(prefix.length);
    const separator = rest.indexOf(':');
    if (separator < 0) continue;
    const path = rest.slice(0, separator);
    const term = rest.slice(separator + 1);
    const terms = hits.get(path) ?? [];
    if (!terms.includes(term)) terms.push(term);
    hits.set(path, terms);
  }
  return hits;
}

const REASON_WEIGHT: Record<DocsSelectionReason, number> = {
  'changed-in-pr': 8,
  'routing-map': 4,
  'symbol-search': 2,
  'nearest-readme': 1,
};

export interface DocsSelection {
  selected: Array<{ path: string; reasons: DocsSelectionReason[] }>;
  overflow: string[];
}

export function selectDocs(
  candidates: ReadonlyMap<string, DocsSelectionReason[]>,
  maxDocs: number,
): DocsSelection {
  const ranked = [...candidates.entries()]
    .map(([path, reasons]) => ({
      path,
      reasons,
      score: reasons.reduce((sum, reason) => sum + REASON_WEIGHT[reason], 0),
    }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return {
    selected: ranked
      .slice(0, maxDocs)
      .map(({ path, reasons }) => ({ path, reasons })),
    overflow: ranked.slice(maxDocs).map(({ path }) => path),
  };
}
