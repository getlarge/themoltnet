import {
  defineTool,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {
  definePiTool,
  type PiToolContext,
  type PiToolContribution,
} from '@themoltnet/pi-runtime';
import { Type } from 'typebox';

export const GITHUB_REPOSITORY = 'getlarge/themoltnet';
export const GITHUB_ISSUE_OPERATION = 'issue.read';
export const GITHUB_ISSUE_TIMEOUT_MS = 5_000;
export const GITHUB_RESPONSE_LIMIT_BYTES = 256 * 1024;
export const GITHUB_ISSUE_BODY_LIMIT_BYTES = 8 * 1024;

export const githubIssueReadParameters = Type.Object(
  {
    number: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

const descriptor = {
  name: 'github_issue_read',
  label: 'Read MoltNet GitHub issue',
  description:
    'Read one public issue from the fixed getlarge/themoltnet repository.',
  parameters: githubIssueReadParameters,
};

export type GitHubIssueResultCategory =
  | 'success'
  | 'cancelled'
  | 'timeout'
  | 'authentication'
  | 'rate_limited'
  | 'not_found'
  | 'invalid_response'
  | 'oversized_response'
  | 'upstream_failure';

interface ToolDependencies {
  fetchImpl?: typeof fetch;
  token?: string;
  timeoutMs?: number;
  now?: () => number;
}

interface ProjectedIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  url: string;
  body: string;
}

class GitHubIssueReadFailure extends Error {
  constructor(
    readonly category: Exclude<GitHubIssueResultCategory, 'success'>,
  ) {
    super(category);
    this.name = 'GitHubIssueReadFailure';
  }
}

export function createGitHubIssueReadTool(
  context: Pick<PiToolContext, 'claimedTask' | 'reporter'>,
  dependencies: ToolDependencies = {},
): ToolDefinition {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const token = dependencies.token;
  const timeoutMs = dependencies.timeoutMs ?? GITHUB_ISSUE_TIMEOUT_MS;
  const now = dependencies.now ?? Date.now;

  return defineTool({
    ...descriptor,
    async execute(toolCallId, { number }, signal) {
      const startedAt = now();
      const evidence = {
        taskId: context.claimedTask.task.id,
        attemptN: context.claimedTask.attemptN,
        toolCallId,
        operation: GITHUB_ISSUE_OPERATION,
        repository: GITHUB_REPOSITORY,
        issueNumber: number,
      };
      if (
        !(await recordEvidence(context, {
          ...evidence,
          phase: 'start',
          resultCategory: 'started',
          durationMs: 0,
        }))
      ) {
        return toolError('upstream_failure', number, now() - startedAt);
      }

      let category: GitHubIssueResultCategory = 'success';
      let projected: ProjectedIssue | undefined;
      try {
        projected = await readIssue({
          number,
          fetchImpl,
          token,
          timeoutMs,
          signal: signal ?? new AbortController().signal,
        });
      } catch (error) {
        category =
          error instanceof GitHubIssueReadFailure
            ? error.category
            : 'upstream_failure';
      }

      const durationMs = Math.max(0, now() - startedAt);
      if (
        !(await recordEvidence(context, {
          ...evidence,
          phase: 'outcome',
          resultCategory: category,
          durationMs,
        }))
      ) {
        return toolError('upstream_failure', number, durationMs);
      }

      if (category !== 'success') {
        return toolError(category, number, durationMs);
      }
      if (!projected) return toolError('invalid_response', number, durationMs);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(projected) }],
        details: {
          operation: GITHUB_ISSUE_OPERATION,
          repository: GITHUB_REPOSITORY,
          issueNumber: number,
          resultCategory: 'success',
          durationMs,
        },
      };
    },
  });
}

export const githubIssueRead: PiToolContribution = definePiTool({
  descriptor,
  scope: 'parent',
  create: (context) =>
    createGitHubIssueReadTool(context, {
      token: process.env.MOLTNET_RUNTIME_GITHUB_TOKEN,
    }),
});

async function readIssue(input: {
  number: number;
  fetchImpl: typeof fetch;
  token?: string;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<ProjectedIssue> {
  if (input.signal.aborted) throw new GitHubIssueReadFailure('cancelled');

  const controller = new AbortController();
  let timedOut = false;
  const onCancel = () => controller.abort();
  input.signal.addEventListener('abort', onCancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, input.timeoutMs);

  const apiUrl =
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/` + input.number;
  try {
    let response: Response;
    try {
      response = await input.fetchImpl(apiUrl, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
        },
      });
    } catch {
      if (input.signal.aborted) {
        throw new GitHubIssueReadFailure('cancelled');
      }
      if (timedOut) throw new GitHubIssueReadFailure('timeout');
      throw new GitHubIssueReadFailure('upstream_failure');
    }

    if (response.status >= 300 && response.status < 400) {
      throw new GitHubIssueReadFailure('invalid_response');
    }
    if (response.status === 401) {
      throw new GitHubIssueReadFailure('authentication');
    }
    if (
      response.status === 429 ||
      (response.status === 403 &&
        response.headers.get('x-ratelimit-remaining') === '0')
    ) {
      throw new GitHubIssueReadFailure('rate_limited');
    }
    if (response.status === 403) {
      throw new GitHubIssueReadFailure('authentication');
    }
    if (response.status === 404) {
      throw new GitHubIssueReadFailure('not_found');
    }
    if (!response.ok) {
      throw new GitHubIssueReadFailure('upstream_failure');
    }

    const bytes = await readBoundedBody(response);
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new GitHubIssueReadFailure('invalid_response');
    }
    return projectIssue(raw, input.number, input.token);
  } catch (error) {
    if (error instanceof GitHubIssueReadFailure) throw error;
    if (input.signal.aborted) throw new GitHubIssueReadFailure('cancelled');
    if (timedOut) throw new GitHubIssueReadFailure('timeout');
    throw new GitHubIssueReadFailure('upstream_failure');
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener('abort', onCancel);
  }
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > GITHUB_RESPONSE_LIMIT_BYTES
  ) {
    throw new GitHubIssueReadFailure('oversized_response');
  }
  if (!response.body) throw new GitHubIssueReadFailure('invalid_response');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > GITHUB_RESPONSE_LIMIT_BYTES) {
        await reader.cancel();
        throw new GitHubIssueReadFailure('oversized_response');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function projectIssue(
  value: unknown,
  requestedNumber: number,
  token?: string,
): ProjectedIssue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GitHubIssueReadFailure('invalid_response');
  }
  const issue = value as Record<string, unknown>;
  if (
    issue.number !== requestedNumber ||
    typeof issue.title !== 'string' ||
    (issue.state !== 'open' && issue.state !== 'closed') ||
    (typeof issue.body !== 'string' && issue.body !== null)
  ) {
    throw new GitHubIssueReadFailure('invalid_response');
  }

  return {
    number: requestedNumber,
    title: truncateUtf8(redactToken(issue.title, token), 1024),
    state: issue.state,
    url: `https://github.com/${GITHUB_REPOSITORY}/issues/${requestedNumber}`,
    body: truncateUtf8(
      redactToken(issue.body ?? '', token),
      GITHUB_ISSUE_BODY_LIMIT_BYTES,
    ),
  };
}

function truncateUtf8(value: string, limit: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= limit) return value;
  return new TextDecoder().decode(bytes.subarray(0, limit));
}

function redactToken(value: string, token?: string): string {
  return token ? value.replaceAll(token, '[redacted]') : value;
}

async function recordEvidence(
  context: Pick<PiToolContext, 'reporter'>,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    await context.reporter.record({
      kind: 'info',
      payload: { event: 'runtime_tool_evidence', ...payload },
    });
    return true;
  } catch {
    return false;
  }
}

function toolError(
  category: Exclude<GitHubIssueResultCategory, 'success'>,
  issueNumber: number,
  durationMs: number,
) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `github_issue_read failed: ${category}`,
      },
    ],
    details: {
      operation: GITHUB_ISSUE_OPERATION,
      repository: GITHUB_REPOSITORY,
      issueNumber,
      resultCategory: category,
      durationMs,
    },
    isError: true,
  };
}
