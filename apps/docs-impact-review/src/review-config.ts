import { posix } from 'node:path';

import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';

import type { Git } from './git.js';
import { type RoutingMap, RoutingRule } from './routing.js';

/** Where a repository keeps its reviewer configuration. */
export const REVIEW_CONFIG_PATH = '.github/docs-impact-review.json';

/** Extra reviewer guidance is advice, not a second brief. */
export const MAX_INSTRUCTIONS_LENGTH = 2_000;

const ReviewConfigSchema = Type.Object(
  {
    version: Type.Literal(1),
    /** Code paths whose changes must be checked against specific docs. */
    routing: Type.Optional(Type.Array(RoutingRule)),
    docs: Type.Optional(
      Type.Object(
        {
          /** Markdown globs that are never reviewed, searched, or selected. */
          exclude: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    /**
     * Globs for instructions written for agents (skills, prompts) rather than
     * users or operators. Replaces the default list when set.
     */
    agentFacing: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    /** Repository-specific guidance added to every stage brief. */
    instructions: Type.Optional(
      Type.String({ minLength: 1, maxLength: MAX_INSTRUCTIONS_LENGTH }),
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

/** Changelogs record history; they are never documentation to review. */
const DEFAULT_DOCS_EXCLUDE = ['**/CHANGELOG.md'];

export const DEFAULT_AGENT_FACING = [
  '.agents/**',
  '.claude/**',
  '.codex/**',
  '.cursor/**',
  '.pi/**',
  '**/skills/**',
];

export const DEFAULT_REVIEW_CONFIG: ReviewConfig = {
  routing: { version: 1, rules: [] },
  docsExclude: DEFAULT_DOCS_EXCLUDE,
  agentFacing: DEFAULT_AGENT_FACING,
};

export function parseReviewConfig(value: unknown): ReviewConfig {
  if (!Value.Check(ReviewConfigSchema, value)) {
    const [first] = Value.Errors(ReviewConfigSchema, value);
    throw new Error(
      `invalid ${REVIEW_CONFIG_PATH} at ${first?.instancePath || '(root)'}: ${first?.message}`,
    );
  }
  return {
    routing: { version: 1, rules: value.routing ?? [] },
    docsExclude: [
      ...new Set([...DEFAULT_DOCS_EXCLUDE, ...(value.docs?.exclude ?? [])]),
    ],
    agentFacing: value.agentFacing ?? DEFAULT_AGENT_FACING,
    ...(value.instructions ? { instructions: value.instructions.trim() } : {}),
  };
}

/**
 * Reads the configuration from the base revision, never the head: a pull
 * request must not be able to change the rules it is reviewed by.
 */
export function loadReviewConfig(
  git: Git,
  baseRevision: string,
): { config: ReviewConfig; source: 'base' | 'default' } {
  // A missing base commit must fail loudly, not read as "no config".
  git(['cat-file', '-e', `${baseRevision}^{commit}`]);
  try {
    git(['cat-file', '-e', `${baseRevision}:${REVIEW_CONFIG_PATH}`]);
  } catch {
    return { config: DEFAULT_REVIEW_CONFIG, source: 'default' };
  }
  const raw = git(['show', `${baseRevision}:${REVIEW_CONFIG_PATH}`]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${REVIEW_CONFIG_PATH} at ${baseRevision} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { config: parseReviewConfig(parsed), source: 'base' };
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => posix.matchesGlob(path, glob));
}
