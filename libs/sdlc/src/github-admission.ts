import {
  approvalAfterBrief,
  type ApprovalEvent,
  createGithubIssueTransport,
  type GithubRequest,
  issueDigest,
} from './github-coordination.js';

/** Read provider evidence; callers persist the returned event as admission provenance. */
export async function readGithubApproval(input: {
  request: GithubRequest;
  repository: string;
  issueNumber: number;
  label: string;
  brief: { presentedAt: string; issueDigest: string; briefDigest: string };
  allowedPermissions: readonly ('admin' | 'write' | 'read')[];
  maxPages?: number;
}): Promise<ReturnType<typeof approvalAfterBrief>> {
  const transport = createGithubIssueTransport(
    input.request,
    input.repository,
    input.issueNumber,
  );
  const maxPages = input.maxPages ?? 20;
  if (
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    !input.label.trim() ||
    !input.allowedPermissions.length
  )
    throw new Error('Invalid approval policy');
  const before = await transport.readIssue();
  if (
    before.state !== 'open' ||
    issueDigest(before) !== input.brief.issueDigest ||
    !before.labels.includes(input.label)
  )
    return undefined;
  const path = `/repos/${input.repository}/issues/${input.issueNumber}/events`;
  const events: ApprovalEvent[] = [];
  const seen = new Set<string>();
  let actor: { id: number; login: string } | undefined;
  let latestTimestampAmbiguous = false;
  for (let page = 1; ; page += 1) {
    if (page > maxPages) throw new Error('Incomplete GitHub approval history');
    const response = await input.request(
      `${path}?per_page=100&page=${page}`,
      'GET',
    );
    if (!Array.isArray(response) || response.length > 100)
      throw new Error('Invalid GitHub event page');
    for (const raw of response) {
      const event = record(raw);
      if (event.event !== 'labeled' && event.event !== 'unlabeled') continue;
      const label = record(event.label);
      if (typeof label.name !== 'string')
        throw new Error('Invalid GitHub event label');
      if (label.name !== input.label) continue;
      if (
        !Number.isSafeInteger(event.id) ||
        typeof event.created_at !== 'string' ||
        !Number.isFinite(Date.parse(event.created_at))
      )
        throw new Error('Invalid GitHub approval event');
      const id = String(event.id);
      if (seen.has(id)) throw new Error('Unstable GitHub approval history');
      seen.add(id);
      const prior = events.at(-1);
      if (prior && Date.parse(prior.createdAt) > Date.parse(event.created_at))
        throw new Error('Unstable GitHub approval ordering');
      // Older ambiguous relabels must not poison a later, unambiguous approval.
      latestTimestampAmbiguous = Boolean(
        prior && Date.parse(prior.createdAt) === Date.parse(event.created_at),
      );
      events.push({
        id,
        action: event.event,
        createdAt: event.created_at,
        authorized: false,
      });
      actor = undefined;
      if (event.actor !== null) {
        const value = record(event.actor);
        if (
          typeof value.id === 'number' &&
          Number.isSafeInteger(value.id) &&
          typeof value.login === 'string' &&
          value.login.length
        )
          actor = { id: value.id, login: value.login };
      }
    }
    if (response.length < 100) break;
  }
  if (latestTimestampAmbiguous)
    throw new Error('Ambiguous GitHub approval ordering');
  const latest = events.at(-1);
  if (!latest || latest.action !== 'labeled' || !actor) return undefined;
  const permission = record(
    await input.request(
      `/repos/${input.repository}/collaborators/${encodeURIComponent(actor.login)}/permission`,
      'GET',
    ),
  );
  const user = record(permission.user);
  latest.authorized =
    user.id === actor.id &&
    input.allowedPermissions.some((value) => value === permission.permission);
  const current = await transport.readIssue();
  if (current.state !== 'open') return undefined;
  return approvalAfterBrief(events, input.brief, {
    issueDigest: issueDigest(current),
    labelPresent: current.labels.includes(input.label),
  });
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid GitHub approval response');
  return value as Record<string, unknown>;
}
