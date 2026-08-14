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

export const EXA_API_ORIGIN = 'https://api.exa.ai';
export const EXA_TIMEOUT_MS = 20_000;
export const EXA_RESPONSE_LIMIT_BYTES = 512 * 1024;
export const EXA_SNIPPET_LIMIT_BYTES = 4 * 1024;
export const EXA_CONTENT_LIMIT_BYTES = 24 * 1024;
export const EXA_MAX_RESULTS = 10;

export type ExaResultCategory =
  | 'success'
  | 'cancelled'
  | 'timeout'
  | 'authentication'
  | 'rate_limited'
  | 'invalid_response'
  | 'oversized_response'
  | 'upstream_failure';

class ExaFailure extends Error {
  constructor(readonly category: Exclude<ExaResultCategory, 'success'>) {
    super(category);
    this.name = 'ExaFailure';
  }
}

export const exaSearchParameters = Type.Object(
  {
    query: Type.String({ minLength: 3, maxLength: 400 }),
    numResults: Type.Optional(
      Type.Integer({ minimum: 1, maximum: EXA_MAX_RESULTS }),
    ),
    /** Lower bound on publication date, as YYYY-MM-DD. */
    startPublishedDate: Type.Optional(
      Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    ),
    /** Restrict to specific hosts, e.g. the watch segment's own domains. */
    includeDomains: Type.Optional(
      Type.Array(Type.String({ minLength: 3, maxLength: 253 }), {
        maxItems: 20,
      }),
    ),
  },
  { additionalProperties: false },
);

export const exaContentsParameters = Type.Object(
  {
    url: Type.String({ minLength: 8, maxLength: 2048 }),
  },
  { additionalProperties: false },
);

const searchDescriptor = {
  name: 'exa_search',
  label: 'Search the web (Exa)',
  description:
    'Search recent public pages through Exa. Returns bounded result snippets with their URLs. Use exa_contents to read a result in full.',
  parameters: exaSearchParameters,
};

const contentsDescriptor = {
  name: 'exa_contents',
  label: 'Read a page (Exa)',
  description:
    'Fetch the extracted text of one URL through Exa. Use this to read a search result before reporting it as a signal.',
  parameters: exaContentsParameters,
};

interface ToolDependencies {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  timeoutMs?: number;
  now?: () => number;
}

interface SearchHit {
  title: string;
  url: string;
  publishedAt?: string;
  snippet: string;
}

interface PageContent {
  url: string;
  title: string;
  publishedAt?: string;
  text: string;
  truncated: boolean;
}

function truncateUtf8(
  value: string,
  limit: number,
): { text: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= limit) return { text: value, truncated: false };
  return {
    text: new TextDecoder().decode(bytes.subarray(0, limit)),
    truncated: true,
  };
}

function redactKey(value: string, apiKey?: string): string {
  return apiKey ? value.replaceAll(apiKey, '[redacted]') : value;
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > EXA_RESPONSE_LIMIT_BYTES
  ) {
    throw new ExaFailure('oversized_response');
  }
  if (!response.body) throw new ExaFailure('invalid_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > EXA_RESPONSE_LIMIT_BYTES) {
        await reader.cancel();
        throw new ExaFailure('oversized_response');
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

/**
 * One bounded POST to a fixed Exa endpoint.
 *
 * The endpoint path is chosen by trusted code here, never by the model: the
 * tool parameters carry a query or a URL, not a route. `redirect: 'error'`
 * keeps a redirect from silently moving the call to another host.
 */
async function callExa(input: {
  path: 'search' | 'contents';
  body: Record<string, unknown>;
  fetchImpl: typeof fetch;
  apiKey: string;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<Record<string, unknown>> {
  if (input.signal.aborted) throw new ExaFailure('cancelled');
  const controller = new AbortController();
  let timedOut = false;
  const onCancel = () => controller.abort();
  input.signal.addEventListener('abort', onCancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, input.timeoutMs);

  try {
    let response: Response;
    try {
      response = await input.fetchImpl(`${EXA_API_ORIGIN}/${input.path}`, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-api-key': input.apiKey,
        },
        body: JSON.stringify(input.body),
      });
    } catch {
      if (input.signal.aborted) throw new ExaFailure('cancelled');
      if (timedOut) throw new ExaFailure('timeout');
      throw new ExaFailure('upstream_failure');
    }

    if (response.status >= 300 && response.status < 400) {
      throw new ExaFailure('invalid_response');
    }
    if (response.status === 401 || response.status === 403) {
      throw new ExaFailure('authentication');
    }
    if (response.status === 429) throw new ExaFailure('rate_limited');
    if (!response.ok) throw new ExaFailure('upstream_failure');

    const bytes = await readBoundedBody(response);
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new ExaFailure('invalid_response');
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ExaFailure('invalid_response');
    }
    return raw as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ExaFailure) throw error;
    if (input.signal.aborted) throw new ExaFailure('cancelled');
    if (timedOut) throw new ExaFailure('timeout');
    throw new ExaFailure('upstream_failure');
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener('abort', onCancel);
  }
}

function optionalIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

function projectSearch(
  raw: Record<string, unknown>,
  apiKey?: string,
): SearchHit[] {
  const results = raw.results;
  if (!Array.isArray(results)) throw new ExaFailure('invalid_response');
  return results.slice(0, EXA_MAX_RESULTS).map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new ExaFailure('invalid_response');
    }
    const hit = entry as Record<string, unknown>;
    if (typeof hit.url !== 'string') throw new ExaFailure('invalid_response');
    const snippetSource =
      typeof hit.text === 'string'
        ? hit.text
        : typeof hit.summary === 'string'
          ? hit.summary
          : '';
    const publishedAt = optionalIsoDate(hit.publishedDate);
    return {
      title: redactKey(
        typeof hit.title === 'string' ? hit.title : hit.url,
        apiKey,
      ),
      url: hit.url,
      ...(publishedAt ? { publishedAt } : {}),
      snippet: truncateUtf8(
        redactKey(snippetSource, apiKey),
        EXA_SNIPPET_LIMIT_BYTES,
      ).text,
    };
  });
}

function projectContents(
  raw: Record<string, unknown>,
  requestedUrl: string,
  apiKey?: string,
): PageContent {
  const results = raw.results;
  if (!Array.isArray(results) || results.length === 0) {
    throw new ExaFailure('invalid_response');
  }
  const first = results[0] as Record<string, unknown>;
  const text = typeof first.text === 'string' ? first.text : '';
  const bounded = truncateUtf8(
    redactKey(text, apiKey),
    EXA_CONTENT_LIMIT_BYTES,
  );
  const publishedAt = optionalIsoDate(first.publishedDate);
  return {
    url: typeof first.url === 'string' ? first.url : requestedUrl,
    title: redactKey(
      typeof first.title === 'string' ? first.title : '',
      apiKey,
    ),
    ...(publishedAt ? { publishedAt } : {}),
    text: bounded.text,
    truncated: bounded.truncated,
  };
}

async function recordEvidence(
  context: Pick<PiToolContext, 'reporter'>,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    await context.reporter.record({ kind: 'info', payload });
    return true;
  } catch {
    return false;
  }
}

/**
 * One details shape for both branches of both tools. Pi infers the tool's
 * `details` generic from the execute return type, so success and failure must
 * agree on the shape or the tool definition stops typechecking.
 */
interface ExaToolDetails {
  operation: string;
  resultCategory: ExaResultCategory;
  durationMs: number;
  resultCount?: number;
  truncated?: boolean;
}

function toolError(
  operation: string,
  category: Exclude<ExaResultCategory, 'success'>,
  durationMs: number,
) {
  const details: ExaToolDetails = {
    operation,
    resultCategory: category,
    durationMs,
  };
  return {
    content: [
      {
        type: 'text' as const,
        text: `${operation} failed: ${category}`,
      },
    ],
    isError: true,
    details,
  };
}

/**
 * Reject a URL the model supplied before it reaches Exa. The model may name any
 * page it found, but it may not use this tool to reach a private address or a
 * non-http scheme.
 */
function assertFetchableUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ExaFailure('invalid_response');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ExaFailure('invalid_response');
  }
  const host = parsed.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    /^(?:10|127)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) throw new ExaFailure('invalid_response');
  return parsed.toString();
}

export function createExaSearchTool(
  context: Pick<PiToolContext, 'claimedTask' | 'reporter'>,
  dependencies: ToolDependencies = {},
): ToolDefinition {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const apiKey = dependencies.apiKey;
  const timeoutMs = dependencies.timeoutMs ?? EXA_TIMEOUT_MS;
  const now = dependencies.now ?? Date.now;

  return defineTool({
    ...searchDescriptor,
    async execute(toolCallId, parameters, signal) {
      const { query, numResults, startPublishedDate, includeDomains } =
        parameters as {
          query: string;
          numResults?: number;
          startPublishedDate?: string;
          includeDomains?: string[];
        };
      const startedAt = now();
      const evidence = {
        taskId: context.claimedTask.task.id,
        attemptN: context.claimedTask.attemptN,
        toolCallId,
        operation: 'exa.search',
        query,
      };
      if (
        !(await recordEvidence(context, {
          ...evidence,
          phase: 'start',
          resultCategory: 'started',
          durationMs: 0,
        }))
      ) {
        return toolError('exa.search', 'upstream_failure', now() - startedAt);
      }
      if (!apiKey) {
        return toolError('exa.search', 'authentication', now() - startedAt);
      }

      let category: ExaResultCategory = 'success';
      let hits: SearchHit[] | undefined;
      try {
        const raw = await callExa({
          path: 'search',
          body: {
            query,
            numResults: Math.min(numResults ?? 5, EXA_MAX_RESULTS),
            type: 'auto',
            contents: { text: { maxCharacters: 2000 } },
            ...(startPublishedDate ? { startPublishedDate } : {}),
            ...(includeDomains?.length ? { includeDomains } : {}),
          },
          fetchImpl,
          apiKey,
          timeoutMs,
          signal: signal ?? new AbortController().signal,
        });
        hits = projectSearch(raw, apiKey);
      } catch (error) {
        category =
          error instanceof ExaFailure ? error.category : 'upstream_failure';
      }

      const durationMs = Math.max(0, now() - startedAt);
      await recordEvidence(context, {
        ...evidence,
        phase: 'outcome',
        resultCategory: category,
        resultCount: hits?.length ?? 0,
        durationMs,
      });
      if (category !== 'success' || !hits) {
        return toolError(
          'exa.search',
          category === 'success' ? 'invalid_response' : category,
          durationMs,
        );
      }
      const details: ExaToolDetails = {
        operation: 'exa.search',
        resultCategory: 'success',
        resultCount: hits.length,
        durationMs,
      };
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ results: hits }) },
        ],
        isError: false,
        details,
      };
    },
  });
}

export function createExaContentsTool(
  context: Pick<PiToolContext, 'claimedTask' | 'reporter'>,
  dependencies: ToolDependencies = {},
): ToolDefinition {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const apiKey = dependencies.apiKey;
  const timeoutMs = dependencies.timeoutMs ?? EXA_TIMEOUT_MS;
  const now = dependencies.now ?? Date.now;

  return defineTool({
    ...contentsDescriptor,
    async execute(toolCallId, parameters, signal) {
      const { url } = parameters as { url: string };
      const startedAt = now();
      const evidence = {
        taskId: context.claimedTask.task.id,
        attemptN: context.claimedTask.attemptN,
        toolCallId,
        operation: 'exa.contents',
        url,
      };
      if (
        !(await recordEvidence(context, {
          ...evidence,
          phase: 'start',
          resultCategory: 'started',
          durationMs: 0,
        }))
      ) {
        return toolError('exa.contents', 'upstream_failure', now() - startedAt);
      }
      if (!apiKey) {
        return toolError('exa.contents', 'authentication', now() - startedAt);
      }

      let category: ExaResultCategory = 'success';
      let page: PageContent | undefined;
      try {
        const safeUrl = assertFetchableUrl(url);
        const raw = await callExa({
          path: 'contents',
          body: { urls: [safeUrl], text: { maxCharacters: 20_000 } },
          fetchImpl,
          apiKey,
          timeoutMs,
          signal: signal ?? new AbortController().signal,
        });
        page = projectContents(raw, safeUrl, apiKey);
      } catch (error) {
        category =
          error instanceof ExaFailure ? error.category : 'upstream_failure';
      }

      const durationMs = Math.max(0, now() - startedAt);
      await recordEvidence(context, {
        ...evidence,
        phase: 'outcome',
        resultCategory: category,
        truncated: page?.truncated ?? false,
        durationMs,
      });
      if (category !== 'success' || !page) {
        return toolError(
          'exa.contents',
          category === 'success' ? 'invalid_response' : category,
          durationMs,
        );
      }
      const details: ExaToolDetails = {
        operation: 'exa.contents',
        resultCategory: 'success',
        truncated: page.truncated,
        durationMs,
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(page) }],
        isError: false,
        details,
      };
    },
  });
}

export const exaSearch: PiToolContribution = definePiTool({
  descriptor: searchDescriptor,
  scope: 'parent',
  create: (context) =>
    createExaSearchTool(context, { apiKey: process.env.EXA_API_KEY }),
});

export const exaContents: PiToolContribution = definePiTool({
  descriptor: contentsDescriptor,
  scope: 'parent',
  create: (context) =>
    createExaContentsTool(context, { apiKey: process.env.EXA_API_KEY }),
});
