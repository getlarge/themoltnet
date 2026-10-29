import type { Revision } from './contracts.js';
import type { GithubRequest } from './github-coordination.js';

/** Starts CI/review after assessment; never grants merge permission. */
export async function markGithubReady(input: {
  request: GithubRequest;
  repository: string;
  pr: number;
  revision: Revision;
  key: string;
  /** Recheck admission, accepted independent assessment, path policy, and current revision. */
  isAuthorized(this: void): Promise<boolean>;
}): Promise<boolean> {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(input.repository) ||
    !Number.isSafeInteger(input.pr) ||
    input.pr < 1 ||
    !input.key
  )
    throw new Error('Invalid review-start binding');
  const read = async () => {
    const value = await input.request(
      `/repos/${input.repository}/pulls/${input.pr}`,
      'GET',
    );
    const pull = object(value);
    const head = object(pull.head);
    const base = object(pull.base);
    if (typeof pull.node_id !== 'string' || typeof pull.draft !== 'boolean')
      throw new Error('Invalid review-start identity');
    if (
      pull.state !== 'open' ||
      pull.merged !== false ||
      head.sha !== input.revision.head ||
      base.sha !== input.revision.base
    )
      return undefined;
    return { id: pull.node_id, draft: pull.draft };
  };
  if (!(await input.isAuthorized())) return false;
  const before = await read();
  if (!before) return false;
  if (!before.draft) return input.isAuthorized();
  if (!(await input.isAuthorized())) return false;
  const response = object(
    await input.request('/graphql', 'POST', {
      query: `mutation SdlcStartReview($input: MarkPullRequestReadyForReviewInput!) {
      markPullRequestReadyForReview(input: $input) { pullRequest { id isDraft } }
    }`,
      variables: {
        input: { pullRequestId: before.id, clientMutationId: input.key },
      },
    }),
  );
  if (
    response.errors !== undefined &&
    (!Array.isArray(response.errors) || response.errors.length)
  )
    throw new Error('GitHub review-start mutation failed');
  const changed = object(
    object(object(response.data).markPullRequestReadyForReview).pullRequest,
  );
  if (changed.id !== before.id || changed.isDraft !== false)
    throw new Error('GitHub review-start response mismatch');
  const after = await read();
  return Boolean(
    after &&
    after.id === before.id &&
    !after.draft &&
    (await input.isAuthorized()),
  );
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid review-start response');
  return value as Record<string, unknown>;
}
