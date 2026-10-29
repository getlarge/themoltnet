import { createHash } from 'node:crypto';

import { type LabelProjection, reconcileStageLabels } from './coordination.js';

export interface GithubIssueSnapshot {
  state: 'open' | 'closed';
  title: string;
  body: string;
  labels: string[];
}

/** The adapter's transport must authenticate as the configured GitHub App. */
export interface GithubIssueTransport {
  readIssue(): Promise<GithubIssueSnapshot>;
  addLabels(labels: string[]): Promise<void>;
  removeLabel(label: string): Promise<void>;
}

/** Labels and assignment changes do not change the approved issue contents. */
export function issueDigest(
  issue: Pick<GithubIssueSnapshot, 'title' | 'body'>,
): string {
  return createHash('sha256')
    .update(JSON.stringify([issue.title, issue.body]))
    .digest('hex');
}

export interface SyncStageInput {
  stage: string;
  policy: LabelProjection;
  expectedIssueDigest: string;
  stopLabels: string[];
}

/**
 * Run under the case's durable ownership. A transport failure is retryable:
 * the next call reads actual labels instead of replaying a cached mutation list.
 */
export async function syncGithubStage(
  transport: GithubIssueTransport,
  input: SyncStageInput,
): Promise<'synced' | 'superseded' | 'interrupted'> {
  const owned = Object.values(input.policy.stages);
  if (input.stopLabels.some((label) => owned.includes(label)))
    throw new Error('Control labels cannot also be stage labels');
  const current = async () => {
    const issue = await transport.readIssue();
    if (
      issue.state !== 'open' ||
      issueDigest(issue) !== input.expectedIssueDigest ||
      input.stopLabels.some((label) => issue.labels.includes(label))
    )
      return undefined;
    return issue;
  };
  let issue = await current();
  if (!issue) return 'superseded';
  let mutations = reconcileStageLabels(issue.labels, input.stage, input.policy);
  // Add first so interrupted transitions retain a visible stage.
  if (mutations.add.length) await transport.addLabels(mutations.add);
  for (const label of mutations.remove) {
    issue = await current();
    if (!issue) return 'superseded';
    if (issue.labels.includes(label)) await transport.removeLabel(label);
  }
  issue = await current();
  if (!issue) return 'superseded';
  mutations = reconcileStageLabels(issue.labels, input.stage, input.policy);
  return mutations.add.length || mutations.remove.length
    ? 'interrupted'
    : 'synced';
}

export interface ApprovalEvent {
  id: string;
  action: 'labeled' | 'unlabeled';
  createdAt: string;
  authorized: boolean;
}

/**
 * Events are the complete timeline for the admission label, in provider order.
 * The trusted brief record comes from the workflow, never arbitrary comment text.
 */
export function approvalAfterBrief(
  events: readonly ApprovalEvent[],
  brief: { presentedAt: string; issueDigest: string; briefDigest: string },
  current: { issueDigest: string; labelPresent: boolean },
): { authorized: true; eventId: string; briefDigest: string } | undefined {
  if (!current.labelPresent || brief.issueDigest !== current.issueDigest)
    return undefined;
  const latest = events.at(-1);
  if (
    !latest ||
    latest.action !== 'labeled' ||
    !latest.authorized ||
    !latest.id
  )
    return undefined;
  const presentedAt = Date.parse(brief.presentedAt);
  const approvedAt = Date.parse(latest.createdAt);
  // Equal timestamps cannot establish ordering; require a fresh approval.
  if (
    !Number.isFinite(presentedAt) ||
    !Number.isFinite(approvedAt) ||
    approvedAt <= presentedAt
  )
    return undefined;
  return {
    authorized: true,
    eventId: latest.id,
    briefDigest: brief.briefDigest,
  };
}

export type GithubRequest = (
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
) => Promise<unknown>;

/** Bind the reconciler to an authenticated, repository-scoped API client. */
export function createGithubIssueTransport(
  request: GithubRequest,
  repository: string,
  issueNumber: number,
): GithubIssueTransport {
  const parts = repository.split('/');
  if (
    parts.length !== 2 ||
    parts.some(
      (part) =>
        !/^[a-zA-Z0-9_.-]+$/.test(part) || part === '.' || part === '..',
    ) ||
    !Number.isSafeInteger(issueNumber) ||
    issueNumber < 1
  )
    throw new Error('Invalid GitHub issue locator');
  const path = `/repos/${parts.map(encodeURIComponent).join('/')}/issues/${issueNumber}`;
  return {
    async readIssue() {
      const value = await request(path, 'GET');
      if (!value || typeof value !== 'object')
        throw new Error('Invalid GitHub issue response');
      const issue = value as Record<string, unknown>;
      if (
        issue['pull_request'] ||
        (issue['state'] !== 'open' && issue['state'] !== 'closed') ||
        typeof issue['title'] !== 'string' ||
        !(issue['body'] === null || typeof issue['body'] === 'string') ||
        !Array.isArray(issue['labels'])
      )
        throw new Error('Invalid GitHub issue response');
      const labels = issue['labels'].map((label: unknown) => {
        if (typeof label === 'string') return label;
        if (
          label &&
          typeof label === 'object' &&
          'name' in label &&
          typeof label.name === 'string'
        )
          return label.name;
        throw new Error('Invalid GitHub label response');
      });
      return {
        state: issue['state'],
        title: issue['title'],
        body: issue['body'] ?? '',
        labels,
      };
    },
    async addLabels(labels) {
      await request(`${path}/labels`, 'POST', { labels });
    },
    async removeLabel(label) {
      await request(`${path}/labels/${encodeURIComponent(label)}`, 'DELETE');
    },
  };
}
