/**
 * Correlation anchor helpers.
 *
 * The daemon writes the task's correlationId in four places when finalizing
 * a fulfill_brief, so the mention-bot (or any external resolver) can recover
 * it from at least one source even if others are stripped: squash merges
 * lose trailers; PR bodies can be edited; comments can vanish.
 *
 * Anchors:
 *   1. MoltNet API (task.references) — populated upstream, not here.
 *   2. Branch name      — `moltnet/<correlationId>/<slug>`
 *   3. Commit trailer   — `Moltnet-Correlation-Id: <uuid>` in the first commit
 *   4. PR body marker   — `<!-- moltnet-correlation: <uuid> -->`
 *
 * Anchors 2 and 3 are produced by the agent during the fulfill run (the
 * system prompt mandates the format); the helpers here build / validate
 * those strings. Anchor 4 is appended by the daemon's finalize hook after
 * the PR is opened.
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
