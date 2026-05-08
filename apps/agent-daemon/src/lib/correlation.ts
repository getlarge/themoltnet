import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { WriteCorrelationAnchors } from './finalize.js';

const execFileAsync = promisify(execFile);

/**
 * Correlation anchor helpers.
 *
 * The daemon writes the task's correlationId in three places on the PR
 * when finalizing a fulfill_brief, so the mention-bot (or any external
 * resolver) can recover it from at least one source even if others are
 * stripped: squash merges lose trailers; PR bodies can be edited;
 * comments can vanish.
 *
 * Anchors (PR-side):
 *   1. Branch name    — `moltnet/<correlationId>/<slug>`
 *   2. Commit trailer — `Moltnet-Correlation-Id: <uuid>` in the first commit
 *   3. PR body marker — `<!-- moltnet-correlation: <uuid> -->`
 *
 * Once any one is recovered, downstream consumers can hit
 * `GET /tasks?correlationId=<id>` to fetch the full chain. The MoltNet
 * API is NOT itself an anchor — it has no URL→correlation lookup —
 * it is the consumer of the anchors.
 *
 * Anchors 1 and 2 are produced by the agent during the fulfill run (the
 * system prompt mandates the format); the helpers here build / validate
 * those strings. Anchor 3 is appended by the daemon's finalize hook
 * after the PR is opened.
 */

const MAX_SLUG_LEN = 60;

export const CORRELATION_TRAILER_KEY = 'Moltnet-Correlation-Id' as const;

// Permissive on the captured id so the writer never silently fails to
// match its own output for non-UUID test fixtures. The resolver (action
// package) still validates the captured value against the UUID shape it
// expects before using it.
export const CORRELATION_MARKER_RE =
  /<!--\s*moltnet-correlation:\s*([\w-]+)\s*-->/i;

const TRAILER_LINE_RE = new RegExp(
  `^${CORRELATION_TRAILER_KEY}:\\s*(\\S+)\\s*$`,
  'm',
);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LEN)
    .replace(/-+$/g, '');
}

export interface BuildBranchNameOptions {
  correlationId: string;
  title: string;
}

export function buildBranchName(opts: BuildBranchNameOptions): string {
  const slug = slugify(opts.title) || 'task';
  return `moltnet/${opts.correlationId}/${slug}`;
}

export function ensureCommitTrailer(
  message: string,
  correlationId: string,
): string {
  const m = message.match(TRAILER_LINE_RE);
  if (m) {
    if (m[1] === correlationId) return message;
    throw new Error(
      `Commit message has a conflicting ${CORRELATION_TRAILER_KEY}: existing=${m[1]} new=${correlationId}`,
    );
  }
  const sep = message.endsWith('\n') ? '\n' : '\n\n';
  return `${message}${sep}${CORRELATION_TRAILER_KEY}: ${correlationId}`;
}

export function appendPrBodyMarker(
  body: string | null | undefined,
  correlationId: string,
): string {
  const marker = `<!-- moltnet-correlation: ${correlationId} -->`;
  if (body && CORRELATION_MARKER_RE.test(body)) return body;
  if (!body) return marker;
  const sep = body.endsWith('\n') ? '\n' : '\n\n';
  return `${body}${sep}${marker}`;
}

// ---------------------------------------------------------------------------
// PR body writer — GETs the PR body via `gh api`, idempotently appends the
// correlation marker if absent, and PATCHes it back. Failures are surfaced
// to the caller; finalize swallows them so the task still completes.
// ---------------------------------------------------------------------------

export interface PrCoords {
  owner: string;
  repo: string;
  number: number;
}

const PR_URL_RE =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/;

export function parsePrUrl(url: string): PrCoords | null {
  const m = url.match(PR_URL_RE);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

export interface GhPrClient {
  get(coords: PrCoords): Promise<{ body: string | null }>;
  patch(coords: PrCoords, body: string): Promise<void>;
}

export interface AnchorWriterDeps {
  gh: GhPrClient;
  logger: {
    warn: (obj: object, msg: string) => void;
    info: (obj: object, msg: string) => void;
  };
}

export function makePrBodyAnchorWriter(
  deps: AnchorWriterDeps,
): WriteCorrelationAnchors {
  return async ({ correlationId, pullRequestUrl }) => {
    const coords = parsePrUrl(pullRequestUrl);
    if (!coords) {
      deps.logger.warn(
        { pullRequestUrl },
        'correlation-anchor: pr url not parseable; skipping',
      );
      return;
    }
    const current = await deps.gh.get(coords);
    const next = appendPrBodyMarker(current.body, correlationId);
    if (next === current.body) {
      deps.logger.info(
        { ...coords, correlationId },
        'correlation-anchor: marker already present',
      );
      return;
    }
    await deps.gh.patch(coords, next);
    deps.logger.info(
      { ...coords, correlationId },
      'correlation-anchor: pr body marker written',
    );
  };
}

/** Default `GhPrClient` backed by the `gh` CLI on PATH. */
export function createGhCliClient(): GhPrClient {
  return {
    async get({ owner, repo, number }) {
      const { stdout } = await execFileAsync('gh', [
        'api',
        `repos/${owner}/${repo}/pulls/${number}`,
        '--jq',
        '{body: .body}',
      ]);
      return JSON.parse(stdout) as { body: string | null };
    },
    async patch({ owner, repo, number }, body) {
      await execFileAsync(
        'gh',
        [
          'api',
          '-X',
          'PATCH',
          `repos/${owner}/${repo}/pulls/${number}`,
          '-f',
          `body=${body}`,
        ],
        { maxBuffer: 10 * 1024 * 1024 },
      );
    },
  };
}
