import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';

import { type Git, requireFullOid } from './git.js';
import { type RoutingMap, RoutingRule } from './routing.js';

/** Where a repository keeps its reviewer configuration. */
export const REVIEW_CONFIG_PATH = '.github/docs-impact-review.json';

/** Extra reviewer guidance is advice, not a second brief. */
export const MAX_INSTRUCTIONS_LENGTH = 2_000;

/** Schema errors reported at once, so one pass fixes several keys. */
const MAX_REPORTED_ERRORS = 5;

const GlobList = Type.Array(Type.String({ minLength: 1 }));

const ReviewConfigSchema = Type.Object(
  {
    version: Type.Literal(1),
    /** Code paths whose changes must be checked against specific docs. */
    routing: Type.Optional(Type.Array(RoutingRule)),
    docs: Type.Optional(
      Type.Object(
        {
          /**
           * Markdown never reviewed, searched, or selected. Added to the
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
  routing: RoutingMap;
  docsExclude: string[];
  agentFacing: string[];
  instructions?: string;
}

/** Where a review's configuration came from, recorded in its report. */
export interface ReviewConfigSource {
  /** `base`: the pull request's base revision; `file`: a local override. */
  kind: 'base' | 'file' | 'default';
  /** The file read, e.g. `.github/docs-impact-review.json@<oid>`. */
  location?: string;
}

/** Changelogs record history; they are never documentation to review. */
export const DEFAULT_DOCS_EXCLUDE = ['**/CHANGELOG.md'];

export const DEFAULT_AGENT_FACING = [
  '.agents/**',
  '.claude/**',
  '.codex/**',
  '.cursor/**',
  '.pi/**',
  '**/skills/**',
];

export const DEFAULT_REVIEW_CONFIG: ReviewConfig = {
  routing: { rules: [] },
  docsExclude: DEFAULT_DOCS_EXCLUDE,
  agentFacing: DEFAULT_AGENT_FACING,
};

/** An invalid or unreadable configuration; the message names what to fix. */
export class ReviewConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewConfigError';
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function describeErrors(value: unknown): string {
  const problems: string[] = [];
  for (const error of Value.Errors(ReviewConfigSchema, value)) {
    if (problems.length === MAX_REPORTED_ERRORS) {
      problems.push('…');
      break;
    }
    const at = error.instancePath || '(root)';
    const unknown = (error.params as { additionalProperties?: string[] })
      .additionalProperties;
    problems.push(
      unknown?.length
        ? `${at}: unknown key ${unknown.map((key) => `"${key}"`).join(', ')}`
        : `${at}: ${error.message}`,
    );
  }
  return problems.join('; ');
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
  return {
    routing: { rules: value.routing ?? [] },
    docsExclude: unique([
      ...DEFAULT_DOCS_EXCLUDE,
      ...(value.docs?.exclude ?? []),
    ]),
    agentFacing: unique([
      ...DEFAULT_AGENT_FACING,
      ...(value.docs?.agentFacing ?? []),
    ]),
    ...(value.instructions ? { instructions: value.instructions.trim() } : {}),
  };
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
  const listed = git([
    'ls-tree',
    '--name-only',
    baseRevision,
    '--',
    REVIEW_CONFIG_PATH,
  ]).trim();
  if (!listed) {
    return { config: DEFAULT_REVIEW_CONFIG, source: { kind: 'default' } };
  }
  const location = `${REVIEW_CONFIG_PATH}@${baseRevision}`;
  const raw = git(['show', `${baseRevision}:${REVIEW_CONFIG_PATH}`]);
  return {
    config: parseReviewConfig(parseJson(raw, location), location),
    source: { kind: 'base', location },
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
  return {
    config: parseReviewConfig(parseJson(raw, path), path),
    source: { kind: 'file', location: path },
  };
}
