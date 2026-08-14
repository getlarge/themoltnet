import { createHash } from 'node:crypto';

import {
  MAX_REPOS,
  MAX_WATCH_SEGMENTS,
  type RepoTarget,
  type Watchlist,
  type WatchSegment,
} from './types.js';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const MAX_SINCE_DAYS = 90;
const MAX_QUERIES_PER_SEGMENT = 8;
const MAX_ORGANISATIONS_PER_SEGMENT = 12;

function requireSlug(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SLUG_PATTERN.test(value)) {
    throw new Error(`${label} must be a kebab-case slug`);
  }
  if (value.length > 40) {
    throw new Error(`${label} must be at most 40 characters`);
  }
  return value;
}

function requireText(value: unknown, label: string, max = 400): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new Error(`${label} must be at most ${max} characters`);
  }
  return trimmed;
}

function requireSinceDays(value: unknown, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_SINCE_DAYS
  ) {
    throw new Error(
      `${label} must be an integer between 1 and ${MAX_SINCE_DAYS}`,
    );
  }
  return value;
}

function requireStringArray(
  value: unknown,
  label: string,
  maxItems: number,
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  if (value.length > maxItems) {
    throw new Error(`${label} must contain at most ${maxItems} entries`);
  }
  return value.map((item, index) => requireText(item, `${label}[${index}]`));
}

function parseRepo(value: unknown, index: number): RepoTarget {
  const label = `watchlist.repos[${index}]`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const repository = requireText(record.repository, `${label}.repository`, 120);
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error(`${label}.repository must be owner/name`);
  }
  const diaryId = record.diaryId;
  if (diaryId !== undefined && typeof diaryId !== 'string') {
    throw new Error(`${label}.diaryId must be a string when present`);
  }
  const focus = record.focus;
  if (focus !== undefined && typeof focus !== 'string') {
    throw new Error(`${label}.focus must be a string when present`);
  }
  return {
    slug: requireSlug(record.slug, `${label}.slug`),
    repository,
    sinceDays: requireSinceDays(record.sinceDays, `${label}.sinceDays`),
    ...(diaryId ? { diaryId } : {}),
    ...(focus ? { focus: requireText(focus, `${label}.focus`) } : {}),
  };
}

function parseSegment(value: unknown, index: number): WatchSegment {
  const label = `watchlist.segments[${index}]`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  return {
    slug: requireSlug(record.slug, `${label}.slug`),
    title: requireText(record.title, `${label}.title`, 120),
    organisations: requireStringArray(
      record.organisations,
      `${label}.organisations`,
      MAX_ORGANISATIONS_PER_SEGMENT,
    ),
    queries: requireStringArray(
      record.queries,
      `${label}.queries`,
      MAX_QUERIES_PER_SEGMENT,
    ),
    sinceDays: requireSinceDays(record.sinceDays, `${label}.sinceDays`),
  };
}

function assertUniqueSlugs(slugs: string[], label: string): void {
  const seen = new Set<string>();
  for (const slug of slugs) {
    if (seen.has(slug)) {
      throw new Error(`${label} contains duplicate slug ${slug}`);
    }
    seen.add(slug);
  }
}

/**
 * Parse and validate an operator-authored watchlist. This runs on the host
 * before anything connects to MoltNet: the watchlist is the run's authority on
 * which repositories and which organisations are in scope, so a malformed or
 * over-broad file must fail here rather than inside an agent prompt.
 */
export function parseWatchlist(source: string): Watchlist {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('watchlist must be strict JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('watchlist must be a JSON object');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error('watchlist.version must be 1');
  }
  if (!Array.isArray(record.repos) || record.repos.length === 0) {
    throw new Error('watchlist.repos must be a non-empty array');
  }
  if (record.repos.length > MAX_REPOS) {
    throw new Error(
      `watchlist.repos must contain at most ${MAX_REPOS} entries`,
    );
  }
  if (!Array.isArray(record.segments) || record.segments.length === 0) {
    throw new Error('watchlist.segments must be a non-empty array');
  }
  if (record.segments.length > MAX_WATCH_SEGMENTS) {
    throw new Error(
      `watchlist.segments must contain at most ${MAX_WATCH_SEGMENTS} entries`,
    );
  }
  const repos = record.repos.map(parseRepo);
  const segments = record.segments.map(parseSegment);
  assertUniqueSlugs(
    repos.map((repo) => repo.slug),
    'watchlist.repos',
  );
  assertUniqueSlugs(
    segments.map((segment) => segment.slug),
    'watchlist.segments',
  );
  const editorialFocus = record.editorialFocus;
  if (editorialFocus !== undefined && typeof editorialFocus !== 'string') {
    throw new Error('watchlist.editorialFocus must be a string when present');
  }
  return {
    version: 1,
    repos,
    segments,
    ...(editorialFocus
      ? {
          editorialFocus: requireText(
            editorialFocus,
            'watchlist.editorialFocus',
            2000,
          ),
        }
      : {}),
  };
}

/**
 * Canonical bytes for the watchlist. Key order is fixed here so the digest is
 * stable across formatting changes to the operator's source file — the digest
 * is what binds a run's signal ids to the scope that produced them.
 */
export function canonicalWatchlistBytes(watchlist: Watchlist): Uint8Array {
  const canonical = {
    version: watchlist.version,
    repos: watchlist.repos.map((repo) => ({
      slug: repo.slug,
      repository: repo.repository,
      sinceDays: repo.sinceDays,
      diaryId: repo.diaryId ?? null,
      focus: repo.focus ?? null,
    })),
    segments: watchlist.segments.map((segment) => ({
      slug: segment.slug,
      title: segment.title,
      organisations: [...segment.organisations].sort(),
      queries: segment.queries,
      sinceDays: segment.sinceDays,
    })),
    editorialFocus: watchlist.editorialFocus ?? null,
  };
  return new TextEncoder().encode(JSON.stringify(canonical));
}

export function watchlistSha256(watchlist: Watchlist): string {
  return createHash('sha256')
    .update(canonicalWatchlistBytes(watchlist))
    .digest('hex');
}
