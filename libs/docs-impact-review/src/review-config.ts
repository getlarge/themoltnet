import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';

import {
  BUDGET_LIMITS,
  type Budgets,
  type ConfigurableBudget,
  resolveBudgets,
} from './budgets.js';
import { type Git, requireFullOid } from './git.js';
import { matchesAny, validateGlob } from './glob.js';
import { type RoutingMap, RoutingRule } from './routing.js';

/** Where a repository keeps its reviewer configuration. */
export const REVIEW_CONFIG_PATH = '.github/docs-impact-review.json';

/** Extra reviewer guidance is advice, not a second brief. */
export const MAX_INSTRUCTIONS_LENGTH = 2_000;

/** Schema errors reported at once, so one pass fixes several keys. */
const MAX_REPORTED_ERRORS = 5;

const GlobList = Type.Array(Type.String({ minLength: 1 }));

const budget = (key: ConfigurableBudget) =>
  Type.Optional(Type.Integer(BUDGET_LIMITS[key]));

const BudgetsSchema = Type.Object(
  {
    diffTotalBytes: budget('diffTotalBytes'),
    diffPerFileBytes: budget('diffPerFileBytes'),
    diffDocsReserveBytes: budget('diffDocsReserveBytes'),
    docsDiffBytes: budget('docsDiffBytes'),
    docExcerptBytes: budget('docExcerptBytes'),
    maxDocs: budget('maxDocs'),
    maxDocsHunks: budget('maxDocsHunks'),
    stageRunningTimeoutSec: budget('stageRunningTimeoutSec'),
  } satisfies Record<ConfigurableBudget, unknown>,
  { additionalProperties: false },
);

/** JSON schema of `.github/docs-impact-review.json`, for editors and tools. */
export const ReviewConfigSchema = Type.Object(
  {
    version: Type.Literal(1),
    /** Code paths whose changes must be checked against specific docs. */
    routing: Type.Optional(Type.Array(RoutingRule)),
    docs: Type.Optional(
      Type.Object(
        {
          /**
           * Files reviewed as documentation besides Markdown (`*.md`,
           * `*.mdx`), e.g. `docs/**\/*.rst`. Added to the built-in
           * patterns; `[]` adds nothing.
           */
          include: Type.Optional(GlobList),
          /**
           * Documentation never reviewed, searched, or selected. Added to the
           * built-in exclusions; `[]` adds nothing.
           */
          exclude: Type.Optional(GlobList),
          /**
           * Instructions written for agents (skills, prompts) rather than
           * users or operators; they rank below user docs. Added to the
           * built-in list; `[]` adds nothing.
           */
          agentFacing: Type.Optional(GlobList),
        },
        { additionalProperties: false },
      ),
    ),
    /**
     * Input and runtime limits; each key overrides one default. Read from
     * the base revision like the rest, so a pull request cannot raise them.
     */
    budgets: Type.Optional(BudgetsSchema),
    /** Repository-specific guidance added to every stage brief. */
    instructions: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: MAX_INSTRUCTIONS_LENGTH,
        pattern: '\\S',
      }),
    ),
  },
  { additionalProperties: false },
);
export type ReviewConfigFile = Static<typeof ReviewConfigSchema>;

export interface ReviewConfig {
  readonly routing: RoutingMap;
  /** Globs reviewed as documentation besides `*.md` and `*.mdx`. */
  readonly docsInclude: readonly string[];
  readonly docsExclude: readonly string[];
  readonly agentFacing: readonly string[];
  readonly instructions?: string;
  /** Only the budgets the repository set; defaults fill the rest. */
  readonly budgets: Readonly<Partial<Budgets>>;
}

/**
 * Where a review's configuration came from, recorded in its report:
 * the pull request's base revision (`<path>@<oid>`), a local override file,
 * or the defaults.
 */
export type ReviewConfigSource =
  | { kind: 'base'; location: string }
  | { kind: 'file'; location: string }
  | { kind: 'default' };

/** Changelogs record history; they are never documentation to review. */
export const DEFAULT_DOCS_EXCLUDE: readonly string[] = Object.freeze([
  '**/CHANGELOG.md',
  // `**` skips dot directories: name them to reach `.github/CHANGELOG.md`.
  '**/.*/**/CHANGELOG.md',
]);

export const DEFAULT_AGENT_FACING: readonly string[] = Object.freeze([
  '.agents/**',
  '.claude/**',
  '.codex/**',
  '.cursor/**',
  '.pi/**',
  '**/skills/**',
  // Skills under a dot directory, e.g. `plugin/.claude/skills/`.
  '**/.*/**/skills/**',
]);

export const DEFAULT_REVIEW_CONFIG: ReviewConfig = Object.freeze({
  routing: Object.freeze({ rules: [] }),
  docsInclude: Object.freeze([]),
  docsExclude: DEFAULT_DOCS_EXCLUDE,
  agentFacing: DEFAULT_AGENT_FACING,
  budgets: Object.freeze({}),
});

/** An invalid or unreadable configuration; the message names what to fix. */
export class ReviewConfigError extends Error {
  constructor(
    message: string,
    /** The configuration that failed, when it was found. */
    readonly source?: ReviewConfigSource,
  ) {
    super(message);
    this.name = 'ReviewConfigError';
  }
}

/** The source of a configuration read from `revision`. */
export function baseConfigSource(
  revision: string,
): Extract<ReviewConfigSource, { kind: 'base' }> {
  return { kind: 'base', location: `${REVIEW_CONFIG_PATH}@${revision}` };
}

/** Runs `parse`, attributing a configuration error to `source`. */
function attributed<T>(source: ReviewConfigSource, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof ReviewConfigError && !error.source) {
      throw new ReviewConfigError(error.message, source);
    }
    throw error;
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function describeErrors(value: unknown): string {
  const errors = [...Value.Errors(ReviewConfigSchema, value)];
  const problems: string[] = [];
  for (const error of errors.slice(0, MAX_REPORTED_ERRORS)) {
    const at = error.instancePath || '(root)';
    const unknown = (error.params as { additionalProperties?: string[] })
      .additionalProperties;
    problems.push(
      unknown?.length
        ? `${at}: unknown key ${unknown.map((key) => `"${key}"`).join(', ')}`
        : `${at}: ${error.message}`,
    );
  }
  const hidden = errors.length - MAX_REPORTED_ERRORS;
  if (hidden > 0) problems.push(`…and ${hidden} more`);
  return problems.join('; ');
}

/**
 * Problems the schema cannot express: unusable globs, and a routed page that
 * is also excluded, which would silently drop a required route.
 */
function describeContradictions(config: ReviewConfig): string[] {
  const problems: string[] = [];
  const globs = [
    ...config.routing.rules.flatMap((rule) =>
      rule.paths.map((glob) => [`routing ${rule.id} paths`, glob] as const),
    ),
    ...config.docsInclude.map((glob) => ['docs.include', glob] as const),
    ...config.docsExclude.map((glob) => ['docs.exclude', glob] as const),
    ...config.agentFacing.map((glob) => ['docs.agentFacing', glob] as const),
  ];
  for (const [where, glob] of globs) {
    const reason = validateGlob(glob);
    if (reason) problems.push(`${where}: "${glob}": ${reason}`);
  }
  const seen = new Set<string>();
  for (const rule of config.routing.rules) {
    if (seen.has(rule.id)) problems.push(`routing id ${rule.id} is repeated`);
    seen.add(rule.id);
    for (const doc of rule.docs) {
      // A routed page is one exact path, so a wildcard is a mistake.
      if (/[*?[\]{}]/.test(doc)) {
        problems.push(
          `routing ${rule.id} docs: "${doc}" must be a path, not a glob`,
        );
      }
      if (matchesAny(doc, config.docsExclude)) {
        problems.push(
          `routing ${rule.id} names ${doc}, which docs.exclude excludes`,
        );
      }
    }
  }
  // Only a value the file sets is a contradiction: the default reserve
  // follows the total, and a default per-file cap above a smaller total is
  // bounded where the diff is built.
  const budgets = resolveBudgets(config.budgets);
  for (const key of ['diffPerFileBytes', 'diffDocsReserveBytes'] as const) {
    if (
      config.budgets[key] !== undefined &&
      budgets[key] > budgets.diffTotalBytes
    ) {
      problems.push(
        `budgets.${key} (${budgets[key]}) exceeds budgets.diffTotalBytes (${budgets.diffTotalBytes})`,
      );
    }
  }
  return problems;
}

/** `location` names the file in errors, e.g. `<path>@<revision>`. */
export function parseReviewConfig(
  value: unknown,
  location = REVIEW_CONFIG_PATH,
): ReviewConfig {
  if (!Value.Check(ReviewConfigSchema, value)) {
    throw new ReviewConfigError(
      `invalid ${location}: ${describeErrors(value)}. Keys this reviewer does not know may need a newer docs impact review version.`,
    );
  }
  const config: ReviewConfig = {
    routing: { rules: value.routing ?? [] },
    docsInclude: unique(value.docs?.include ?? []),
    docsExclude: unique([
      ...DEFAULT_DOCS_EXCLUDE,
      ...(value.docs?.exclude ?? []),
    ]),
    agentFacing: unique([
      ...DEFAULT_AGENT_FACING,
      ...(value.docs?.agentFacing ?? []),
    ]),
    ...(value.instructions ? { instructions: value.instructions.trim() } : {}),
    budgets: value.budgets ?? {},
  };
  const contradictions = describeContradictions(config);
  if (contradictions.length > 0) {
    throw new ReviewConfigError(
      `invalid ${location}: ${contradictions.join('; ')}`,
    );
  }
  return config;
}

function parseJson(raw: string, location: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new ReviewConfigError(
      `${location} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Reads the configuration from the base revision, never the head: a pull
 * request must not be able to change the rules it is reviewed by.
 */
export function loadReviewConfig(
  git: Git,
  baseRevision: string,
): { config: ReviewConfig; source: ReviewConfigSource } {
  requireFullOid(baseRevision, 'base revision');
  // `ls-tree` prints nothing for an absent path and fails for a missing or
  // corrupt object, so only a real absence falls back to the defaults.
  // --full-tree: resolve the path from the repository root, as `git show`
  // does, whatever the working directory.
  const listed = git([
    'ls-tree',
    '--full-tree',
    '--name-only',
    baseRevision,
    '--',
    REVIEW_CONFIG_PATH,
  ]).trim();
  if (!listed) {
    return { config: DEFAULT_REVIEW_CONFIG, source: { kind: 'default' } };
  }
  const source = baseConfigSource(baseRevision);
  const raw = git(['show', `${baseRevision}:${REVIEW_CONFIG_PATH}`]);
  return {
    config: attributed(source, () =>
      parseReviewConfig(parseJson(raw, source.location), source.location),
    ),
    source,
  };
}

/** Reads a local configuration file, e.g. to replay older pull requests. */
export function loadReviewConfigFile(
  readFile: (path: string) => string,
  path: string,
): { config: ReviewConfig; source: ReviewConfigSource } {
  let raw: string;
  try {
    raw = readFile(path);
  } catch (error) {
    throw new ReviewConfigError(
      `cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const source: ReviewConfigSource = { kind: 'file', location: path };
  return {
    config: attributed(source, () =>
      parseReviewConfig(parseJson(raw, path), path),
    ),
    source,
  };
}
