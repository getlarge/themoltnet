import { githubPullRequestNumber } from './github-change.js';
import type { GithubRequest } from './github-coordination.js';
import type { OutcomeInput } from './outcome.js';

/** Validate the exact closure observation without inferring a finding disposition. */
export async function githubOutcomeIsCurrent(
  input: OutcomeInput,
  request: GithubRequest,
): Promise<boolean> {
  const item = input.handoff.workItem;
  if (item.provider !== 'github' || input.observation.state === 'cancelled')
    return false;
  const pr = githubPullRequestNumber(
    input.observation.providerUrl,
    item.repository,
  );
  if (!pr) return false;
  const raw = await request(`/repos/${item.repository}/pulls/${pr}`, 'GET');
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('head' in raw) ||
    !raw.head ||
    typeof raw.head !== 'object' ||
    !('sha' in raw.head) ||
    !('state' in raw) ||
    !('closed_at' in raw) ||
    !('merged' in raw)
  )
    throw new Error('Invalid GitHub closure response');
  if (
    raw.state !== 'closed' ||
    raw.closed_at !== input.observation.occurredAt ||
    raw.head.sha !== input.handoff.revision.head
  )
    return false;
  if (input.observation.state === 'closed-unmerged')
    return raw.merged === false;
  return (
    raw.merged === true &&
    Boolean(input.observation.mergeCommit) &&
    'merge_commit_sha' in raw &&
    raw.merge_commit_sha === input.observation.mergeCommit
  );
}
