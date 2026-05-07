/**
 * Parse a GitHub issue/PR comment for `@moltnet-<verb>` mentions.
 *
 * v1 supports:
 *   - `@moltnet-fulfill` on an issue → creates a fulfill_brief task
 *   - `@moltnet-assess` on a PR → no-op with a "deferred, blocked on #881"
 *     reply (auto-dispatch needs the rubric registry first)
 *
 * Wrong-context mentions (fulfill on PR, assess on issue) return verb=null
 * with a reason so the dispatcher can post a friendly diagnostic.
 */

export type Verb = 'fulfill' | 'assess';

export type ParseResult =
  | { verb: 'fulfill'; taskType: 'fulfill_brief' }
  | { verb: 'assess'; deferred: true; blockedOn: number }
  | { verb: null; reason: string };

export interface ParseInput {
  body: string;
  isPullRequest: boolean;
}

const MENTION_RE = /@moltnet-([a-z]+)\b/i;

export function parseMention({ body, isPullRequest }: ParseInput): ParseResult {
  const m = body.match(MENTION_RE);
  if (!m) return { verb: null, reason: 'no @moltnet-* mention found' };

  const verb = m[1].toLowerCase();
  if (verb === 'fulfill') {
    if (isPullRequest)
      return {
        verb: null,
        reason: 'fulfill is for issues; this comment is on a PR',
      };
    return { verb: 'fulfill', taskType: 'fulfill_brief' };
  }
  if (verb === 'assess') {
    if (!isPullRequest)
      return {
        verb: null,
        reason: 'assess is for PRs; this comment is on an issue',
      };
    return { verb: 'assess', deferred: true, blockedOn: 881 };
  }
  return { verb: null, reason: `unknown verb: ${verb}` };
}
